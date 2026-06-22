import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";
import {
  toolToTopic,
  topicCategory,
  topicColor,
  GENERAL_SUPPORT_TOPIC,
} from "@/lib/brain-topics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const days = Math.min(parseInt(searchParams.get("days") || "30"), 365);
    const merchant = searchParams.get("merchant") || "";

    const merchantFilter = merchant
      ? `AND merchant_name = '${merchant.replace(/'/g, "''")}'`
      : "";

    const interval = `${days} days`;

    // Run all queries in parallel
    const [topicStats, coOccurrence, topMerchants, weeklyTrend, recentQs, knowledgeStats] =
      await Promise.all([
        // Q1: Topic frequency, errors, avg rounds
        query(`
          WITH topic_extract AS (
            SELECT
              c.id,
              c.merchant_name,
              c.error,
              c.rounds,
              CASE
                WHEN jsonb_array_length(c.tool_calls) = 0 THEN '__general__'
                ELSE tc.elem->>'tool'
              END AS tool_name
            FROM pascal_conversation_log c
            LEFT JOIN LATERAL jsonb_array_elements(c.tool_calls) AS tc(elem) ON jsonb_array_length(c.tool_calls) > 0
            WHERE c.created_at >= now() - interval '${interval}'
            ${merchantFilter}
          ),
          deduped AS (
            SELECT DISTINCT id, merchant_name, error, rounds, tool_name
            FROM topic_extract
          )
          SELECT
            tool_name,
            COUNT(*) AS count,
            COUNT(*) FILTER (WHERE error IS NOT NULL) AS error_count,
            ROUND(AVG(rounds), 1) AS avg_rounds
          FROM deduped
          GROUP BY tool_name
          ORDER BY count DESC
        `),

        // Q2: Co-occurrence edges (pairs of topics used by the same merchant)
        query(`
          WITH topic_extract AS (
            SELECT
              c.merchant_name,
              CASE
                WHEN jsonb_array_length(c.tool_calls) = 0 THEN '__general__'
                ELSE tc.elem->>'tool'
              END AS tool_name
            FROM pascal_conversation_log c
            LEFT JOIN LATERAL jsonb_array_elements(c.tool_calls) AS tc(elem) ON jsonb_array_length(c.tool_calls) > 0
            WHERE c.created_at >= now() - interval '${interval}'
            ${merchantFilter}
          ),
          merchant_topics AS (
            SELECT DISTINCT merchant_name, tool_name FROM topic_extract
          )
          SELECT
            a.tool_name AS source,
            b.tool_name AS target,
            COUNT(DISTINCT a.merchant_name) AS weight
          FROM merchant_topics a
          JOIN merchant_topics b
            ON a.merchant_name = b.merchant_name
            AND a.tool_name < b.tool_name
          GROUP BY a.tool_name, b.tool_name
          ORDER BY weight DESC
        `),

        // Q3: Top merchants by question count
        query(`
          SELECT merchant_name, COUNT(*) AS question_count
          FROM pascal_conversation_log
          WHERE created_at >= now() - interval '${interval}'
          ${merchantFilter}
          GROUP BY merchant_name
          ORDER BY question_count DESC
          LIMIT 10
        `),

        // Q4: Weekly trend
        query(`
          WITH topic_extract AS (
            SELECT
              date_trunc('week', c.created_at)::date AS week,
              CASE
                WHEN jsonb_array_length(c.tool_calls) = 0 THEN '__general__'
                ELSE tc.elem->>'tool'
              END AS tool_name
            FROM pascal_conversation_log c
            LEFT JOIN LATERAL jsonb_array_elements(c.tool_calls) AS tc(elem) ON jsonb_array_length(c.tool_calls) > 0
            WHERE c.created_at >= now() - interval '${interval}'
            ${merchantFilter}
          )
          SELECT week, tool_name, COUNT(*) AS count
          FROM (SELECT DISTINCT * FROM topic_extract) sub
          GROUP BY week, tool_name
          ORDER BY week, count DESC
        `),

        // Q5: Recent questions per topic (last 5 each)
        query(`
          WITH topic_extract AS (
            SELECT
              c.id,
              c.question,
              c.merchant_name,
              c.created_at,
              CASE
                WHEN jsonb_array_length(c.tool_calls) = 0 THEN '__general__'
                ELSE tc.elem->>'tool'
              END AS tool_name
            FROM pascal_conversation_log c
            LEFT JOIN LATERAL jsonb_array_elements(c.tool_calls) AS tc(elem) ON jsonb_array_length(c.tool_calls) > 0
            WHERE c.created_at >= now() - interval '${interval}'
            ${merchantFilter}
          ),
          ranked AS (
            SELECT DISTINCT ON (tool_name, id)
              tool_name, id, question, merchant_name, created_at,
              ROW_NUMBER() OVER (PARTITION BY tool_name ORDER BY created_at DESC) AS rn
            FROM topic_extract
          )
          SELECT tool_name, id, question, merchant_name, created_at
          FROM ranked
          WHERE rn <= 5
          ORDER BY tool_name, created_at DESC
        `),

        // Q6: Knowledge base coverage stats
        query(`
          SELECT category, COUNT(*) AS entry_count, COALESCE(SUM(hit_count), 0) AS total_hits
          FROM pascal_knowledge_base
          WHERE is_active = true
          GROUP BY category
          ORDER BY total_hits DESC
        `),
      ]);

    // --- Map raw SQL results to the response shape ---

    // Nodes
    const nodes = topicStats.rows.map((r) => {
      const rawTool = r.tool_name;
      const topic =
        rawTool === "__general__"
          ? GENERAL_SUPPORT_TOPIC
          : toolToTopic(rawTool);
      const category = topicCategory(topic);
      const color = topicColor(topic);
      return {
        id: topic,
        label: topic,
        category,
        color,
        count: parseInt(r.count),
        errorCount: parseInt(r.error_count),
        avgRounds: parseFloat(r.avg_rounds),
      };
    });

    // Edges
    const edges = coOccurrence.rows.map((r) => {
      const src =
        r.source === "__general__"
          ? GENERAL_SUPPORT_TOPIC
          : toolToTopic(r.source);
      const tgt =
        r.target === "__general__"
          ? GENERAL_SUPPORT_TOPIC
          : toolToTopic(r.target);
      return {
        source: src,
        target: tgt,
        weight: parseInt(r.weight),
      };
    });

    // Insights
    const topTopics = nodes
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((n) => ({ topic: n.id, category: n.category, count: n.count }));

    const errorTopics = nodes
      .filter((n) => n.count >= 2)
      .map((n) => ({
        topic: n.id,
        errorCount: n.errorCount,
        totalCount: n.count,
        errorRate: Math.round((n.errorCount / n.count) * 100),
      }))
      .filter((n) => n.errorCount > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 5);

    const topMerchantsList = topMerchants.rows.map((r) => ({
      merchant: r.merchant_name,
      questionCount: parseInt(r.question_count),
    }));

    const complexTopics = nodes
      .filter((n) => n.count >= 2)
      .sort((a, b) => b.avgRounds - a.avgRounds)
      .slice(0, 5)
      .map((n) => ({
        topic: n.id,
        avgRounds: n.avgRounds,
        count: n.count,
      }));

    const weeklyTrendData = weeklyTrend.rows.map((r) => ({
      week: r.week,
      topic:
        r.tool_name === "__general__"
          ? GENERAL_SUPPORT_TOPIC
          : toolToTopic(r.tool_name),
      count: parseInt(r.count),
    }));

    // Recent questions grouped by topic
    const recentQuestions: Record<
      string,
      { id: string; question: string; merchant: string; createdAt: string }[]
    > = {};
    for (const r of recentQs.rows) {
      const topic =
        r.tool_name === "__general__"
          ? GENERAL_SUPPORT_TOPIC
          : toolToTopic(r.tool_name);
      if (!recentQuestions[topic]) recentQuestions[topic] = [];
      if (recentQuestions[topic].length < 5) {
        recentQuestions[topic].push({
          id: r.id,
          question: r.question,
          merchant: r.merchant_name,
          createdAt: r.created_at,
        });
      }
    }

    // Knowledge coverage
    const knowledgeCoverage = knowledgeStats.rows.map((r) => ({
      category: r.category,
      entryCount: parseInt(r.entry_count),
      totalHits: parseInt(r.total_hits),
    }));

    return NextResponse.json({
      graph: { nodes, edges },
      insights: {
        topTopics,
        errorTopics,
        topMerchants: topMerchantsList,
        complexTopics,
        weeklyTrend: weeklyTrendData,
        knowledgeCoverage,
      },
      recentQuestions,
    });
  } catch (err) {
    console.error("Brain API error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
