import { describe, expect, test } from "bun:test"
import { chat, responses } from "./sse"
import type { Part } from "./contracts"

function body(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

async function collect(events: AsyncIterable<Part>) {
  const parts: Part[] = []
  for await (const part of events) parts.push(part)
  return parts
}

describe("sse usage parsing", () => {
  test("emits normalized chat usage parts", async () => {
    const parts = await collect(
      chat(
        body([
          'data: {"choices":[{"delta":{"content":"hi"}}]}',
          "",
          'data: {"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17,"prompt_tokens_details":{"cached_tokens":4},"completion_tokens_details":{"reasoning_tokens":2},"cost":{"usd":0.03}},"choices":[{"finish_reason":"stop"}]}',
          "",
        ].join("\n")),
      ),
    )

    expect(parts).toEqual([
      { type: "text", text: "hi" },
      {
        type: "usage",
        usage: {
          inputTokens: 12,
          outputTokens: 5,
          totalTokens: 17,
          reasoningTokens: 2,
          cachedInputTokens: 4,
          cost: { usd: 0.03 },
        },
      },
      { type: "done", reason: "stop" },
    ])
  })

  test("emits normalized responses usage parts", async () => {
    const parts = await collect(
      responses(
        body([
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"hello"}',
          "",
          'event: response.completed',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":9,"total_tokens":29,"input_tokens_details":{"cached_tokens":6},"output_tokens_details":{"reasoning_tokens":3},"cost":{"usd":0.07,"provider":"test"}}},"status":"completed"}',
          "",
        ].join("\n")),
      ),
    )

    expect(parts).toEqual([
      { type: "text", text: "hello" },
      {
        type: "usage",
        usage: {
          inputTokens: 20,
          outputTokens: 9,
          totalTokens: 29,
          reasoningTokens: 3,
          cachedInputTokens: 6,
          cost: { usd: 0.07, provider: "test" },
        },
      },
      { type: "done", reason: "completed" },
    ])
  })
})
