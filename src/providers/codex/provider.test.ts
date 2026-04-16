import { afterEach, describe, expect, test } from "bun:test"
import { codex } from "./provider"
import type { Msg } from "../../core/contracts"

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

function captureWith(handler: (call: FetchCall, index: number) => Promise<Response> | Response) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input, init) => {
    const call = { input, init }
    calls.push(call)
    return handler(call, calls.length - 1)
  }) as typeof globalThis.fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("codex provider request shape", () => {
  test("sends top-level instructions, excludes system messages, and skips plain assistant replay", async () => {
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
        reasoning: { effort: "xhigh" },
        tools: [{ name: "lookup", description: "Look up a record", schema: { type: "object" } }],
      },
    )

    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.input)).toBe("https://chatgpt.com/backend-api/codex/responses")

    const requestHeaders = headers(calls[0]!)
    expect(requestHeaders.Authorization).toBe(`Bearer ${access}`)
    expect(requestHeaders["Content-Type"]).toBe("application/json")
    expect(requestHeaders.originator).toBe("tiny-agent-runtime")
    expect(requestHeaders["ChatGPT-Account-Id"]).toBe("acct_123")
    expect(requestHeaders.session_id).toBe("sess_123")
    expect(requestHeaders["User-Agent"]).toContain("@tiny-agent/tiny-agent-runtime/0.0.0")

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
      ],
      reasoning: { effort: "xhigh" },
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

  test("keeps assistant tool calls and tool results in replay input", async () => {
    const calls = capture()

    await codex.prompt(
      { refresh: "refresh-token", access: token({ session_id: "sess_123" }), expires: Date.now() + 60_000 },
      {
        model: "gpt-5.4",
        msg: [
          { role: "user", content: "Use a tool." },
          { role: "assistant", calls: [{ id: "call_1", name: "lookup", input: '{"id":1}' }] },
          { role: "tool", id: "call_1", name: "lookup", content: "result" },
        ],
      },
    )

    expect(body(calls[0]!).input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "Use a tool." }],
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
    ])
  })

  test("drops unsupported reasoning effort for non-gpt-5 codex models", async () => {
    const calls = capture()

    await codex.prompt(
      { refresh: "refresh-token", access: token({ session_id: "sess_123" }), expires: Date.now() + 60_000 },
      {
        model: "custom-codex-preview",
        msg: [{ role: "user", content: "Hi" }],
        reasoning: { effort: "medium" },
      },
    )

    expect(body(calls[0]!)).toEqual({
      model: "custom-codex-preview",
      instructions: "You are a helpful assistant.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hi" }],
        },
      ],
      store: false,
      stream: true,
    })
  })

  test("prefers prompt sessionId over token session claim", async () => {
    const calls = capture()
    const access = token({ session_id: "sess_token" })

    await codex.prompt(
      { refresh: "refresh-token", access, expires: Date.now() + 60_000 },
      {
        model: "gpt-5.4",
        msg: [{ role: "user", content: "Hi" }],
        sessionId: "sess_logical",
      },
    )

    expect(headers(calls[0]!).session_id).toBe("sess_logical")
  })

  test("falls back to token session claim when prompt sessionId is absent", async () => {
    const calls = capture()
    const access = token({ session_id: "sess_token" })

    await codex.prompt(
      { refresh: "refresh-token", access, expires: Date.now() + 60_000 },
      {
        model: "gpt-5.4",
        msg: [{ role: "user", content: "Hi" }],
      },
    )

    expect(headers(calls[0]!).session_id).toBe("sess_token")
  })

  test("refreshes near-expiry auth before sending the codex request", async () => {
    const refreshedAccess = token({ session_id: "sess_refreshed" })
    const calls = captureWith((call, index) => {
      if (index === 0) {
        expect(String(call.input)).toBe("https://auth.openai.com/oauth/token")
        expect(call.init?.method).toBe("POST")
        expect(typeof call.init?.body).toBe("string")
        expect(String(call.init?.body)).toContain("grant_type=refresh_token")
        expect(String(call.init?.body)).toContain("refresh_token=refresh-old")
        return Response.json({
          refresh_token: "refresh-new",
          access_token: refreshedAccess,
          expires_in: 120,
          id_token: token({ chatgpt_account_id: "acct_new" }),
        })
      }

      expect(String(call.input)).toBe("https://chatgpt.com/backend-api/codex/responses")
      return ok()
    })

    const run = await codex.prompt(
      { refresh: "refresh-old", access: token({ session_id: "sess_old" }), expires: Date.now() + 5_000, accountId: "acct_old" },
      {
        model: "gpt-5.4",
        msg: [{ role: "user", content: "Hi" }],
      },
    )

    expect(calls).toHaveLength(2)
    expect(run.auth.refresh).toBe("refresh-new")
    expect(run.auth.access).toBe(refreshedAccess)
    expect(run.auth.accountId).toBe("acct_new")
    expect(run.auth.expires).toBeGreaterThan(Date.now())

    const requestHeaders = headers(calls[1]!)
    expect(requestHeaders.Authorization).toBe(`Bearer ${refreshedAccess}`)
    expect(requestHeaders["ChatGPT-Account-Id"]).toBe("acct_new")
    expect(requestHeaders.session_id).toBe("sess_refreshed")
  })
})
