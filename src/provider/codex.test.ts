import { afterEach, describe, expect, test } from "bun:test"
import { codex } from "./codex"
import type { Msg } from "../core/contracts"

const originalFetch = globalThis.fetch

type FetchCall = {
  input: RequestInfo | URL
  init?: RequestInit
}

function token(claims: Record<string, unknown>) {
  return `a.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.b`
}

function ok() {
  return new Response("data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  })
}

function capture() {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init })
    return ok()
  }) as typeof globalThis.fetch
  return calls
}

function body(call: FetchCall) {
  expect(typeof call.init?.body).toBe("string")
  return JSON.parse(call.init?.body as string) as Record<string, unknown>
}

function headers(call: FetchCall) {
  return call.init?.headers as Record<string, string>
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("codex provider request shape", () => {
  test("sends top-level instructions and excludes system messages from input", async () => {
    const calls = capture()
    const access = token({ session_id: "sess_123" })
    const msg: Msg[] = [
      { role: "system", content: "You are precise." },
      { role: "system", content: "Prefer bullets." },
      { role: "user", content: "Summarize this." },
      { role: "assistant", calls: [{ id: "call_1", name: "lookup", input: '{"id":1}' }] },
      { role: "tool", id: "call_1", name: "lookup", content: "result" },
      { role: "assistant", content: "Done." },
    ]

    await codex.prompt(
      { refresh: "refresh-token", access, expires: Date.now() + 60_000, accountId: "acct_123" },
      {
        model: "gpt-5.4",
        msg,
        tools: [{ name: "lookup", description: "Look up a record", schema: { type: "object" } }],
      },
    )

    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.input)).toBe("https://chatgpt.com/backend-api/codex/responses")

    const requestHeaders = headers(calls[0]!)
    expect(requestHeaders.Authorization).toBe(`Bearer ${access}`)
    expect(requestHeaders["Content-Type"]).toBe("application/json")
    expect(requestHeaders.originator).toBe("opencode")
    expect(requestHeaders["ChatGPT-Account-Id"]).toBe("acct_123")
    expect(requestHeaders.session_id).toBe("sess_123")
    expect(requestHeaders["User-Agent"]).toContain("@pumpkinredbean/tiny-agent-runtime/0.0.0")

    expect(body(calls[0]!)).toEqual({
      model: "gpt-5.4",
      instructions: "You are precise.\nPrefer bullets.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Summarize this." }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: '{"id":1}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "result",
        },
        {
          role: "assistant",
          content: [{ type: "input_text", text: "Done." }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Look up a record",
          parameters: { type: "object" },
        },
      ],
      store: false,
      stream: true,
    })
  })
})
