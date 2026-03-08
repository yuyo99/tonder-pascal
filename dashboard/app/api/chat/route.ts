import Anthropic from "@anthropic-ai/sdk";
import { getSystemPrompt } from "@/lib/chat-prompt";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/chat-tools";

const MAX_ROUNDS = 8;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: ChatMessage[] };

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          const systemPrompt = getSystemPrompt();
          const startTime = Date.now();

          // Build Anthropic message array from chat history
          const anthropicMessages: Anthropic.MessageParam[] = messages.map(
            (m) => ({
              role: m.role,
              content: m.content,
            })
          );

          let rounds = 0;
          let finalAnswer = "";

          while (rounds < MAX_ROUNDS) {
            rounds++;

            const response = await client.messages.create({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 4096,
              system: systemPrompt,
              tools: TOOL_DEFINITIONS,
              messages: anthropicMessages,
            });

            // Extract text and tool blocks
            const textBlocks = response.content.filter(
              (b): b is Anthropic.TextBlock => b.type === "text"
            );
            const toolBlocks = response.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            // If no tools, we're done
            if (toolBlocks.length === 0) {
              finalAnswer =
                textBlocks.map((b) => b.text).join("\n") ||
                "I couldn't generate a response.";
              send({ type: "text", content: finalAnswer });
              send({
                type: "done",
                rounds,
                latencyMs: Date.now() - startTime,
              });
              break;
            }

            // Claude wants to call tools
            // Add assistant message to conversation
            anthropicMessages.push({
              role: "assistant",
              content: response.content,
            });

            // Execute each tool and stream events
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const toolBlock of toolBlocks) {
              // Stream tool_call event
              send({
                type: "tool_call",
                tool: toolBlock.name,
                input: toolBlock.input,
              });

              // Execute the tool
              const result = await executeTool(
                toolBlock.name,
                toolBlock.input as Record<string, unknown>
              );

              // Stream tool_result event (brief preview)
              const preview = result.length > 300 ? result.slice(0, 300) + "..." : result;
              send({
                type: "tool_result",
                tool: toolBlock.name,
                preview,
              });

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: result,
              });
            }

            // Add tool results to conversation
            anthropicMessages.push({
              role: "user",
              content: toolResults,
            });

            // If stop_reason is end_turn, extract any text and finish
            if (response.stop_reason === "end_turn") {
              finalAnswer =
                textBlocks.map((b) => b.text).join("\n") ||
                "I couldn't generate a response.";
              send({ type: "text", content: finalAnswer });
              send({
                type: "done",
                rounds,
                latencyMs: Date.now() - startTime,
              });
              break;
            }

            // Check if we've hit max rounds
            if (rounds >= MAX_ROUNDS) {
              send({
                type: "text",
                content:
                  "I needed too many steps to answer that. Please try a more specific question.",
              });
              send({
                type: "done",
                rounds,
                latencyMs: Date.now() - startTime,
              });
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          send({ type: "error", message: msg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
