import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const category = searchParams.get("category") || "";
    const search = searchParams.get("search") || "";

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (category) {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }

    if (search) {
      conditions.push(
        `(match_pattern ILIKE $${idx} OR title ILIKE $${idx} OR content ILIKE $${idx})`
      );
      params.push(`%${search}%`);
      idx++;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT id, category, match_pattern, title, content, action, priority,
              is_active, hit_count, created_at, updated_at
       FROM pascal_knowledge_base
       ${where}
       ORDER BY is_active DESC, priority ASC, created_at DESC`,
      params
    );

    return NextResponse.json({ entries: result.rows });
  } catch (err) {
    console.error("Memory GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, match_pattern, title, content, action, priority } = body;

    if (!category || !match_pattern || !title || !content) {
      return NextResponse.json(
        { error: "category, match_pattern, title, and content are required" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO pascal_knowledge_base (category, match_pattern, title, content, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        category,
        match_pattern,
        title,
        content,
        action || null,
        priority || 5,
      ]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("Memory POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
