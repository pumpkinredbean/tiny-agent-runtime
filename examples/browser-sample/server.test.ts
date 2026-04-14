import { describe, expect, test } from "bun:test"
import type { Part } from "../../src/core/contracts"
import { createSampleApp, parsePromptRequest } from "./server"

async function collect(res: Response) {
  return await res.text()
}

async function* parts(...items: Part[]) {
  for (const item of items) yield item
}

describe("sample prompt request parsing", () => {
  test("accepts provider fallback from env and normalizes fields", async () => {
    const req = new Request("http://local/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "  Hello  ",
        system: "  Be concise  ",
        history: [{ role: "assistant", content: "Earlier" }],
      }),
    })

    await expect(parsePromptRequest(req, { RUNTIME_PROVIDER: "codex" })).resolves.toEqual({
      provider: "codex",
      model: undefined,
      system: "Be concise",
      prompt: "Hello",
      history: [{ role: "assistant", content: "Earlier" }],
    })
  })

  test("rejects malformed history", async () => {
    const req = new Request("http://local/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "codex", prompt: "Hello", history: [{ role: "tool", content: "x" }] }),
    })

    await expect(parsePromptRequest(req, {})).rejects.toThrow(
      "history entries must use user/assistant roles with string content",
    )
  })
})

describe("sample routes", () => {
  test("serves the index page", async () => {
    const app = createSampleApp({
      env: {},
      readIndex: async () => "<html>ok</html>",
    })

    const res = await app.fetch(new Request("http://local/"))

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/html")
    expect(await res.text()).toBe("<html>ok</html>")
  })

  test("streams SSE prompt parts and persists refreshed codex auth", async () => {
    const saved: Array<Record<string, unknown>> = []
    const app = createSampleApp({
      env: {},
      readIndex: async () => "index",
      getAuth: async () => ({ refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" }),
      setCodexAuth: async (auth) => {
        saved.push(auth)
      },
      codexPrompt: async () => ({
        auth: { refresh: "r2", access: "a2", expires: 2, accountId: "acct_1" },
        model: "gpt-5.4-mini",
        url: "https://example.test",
        events: parts({ type: "text", text: "hello" }, { type: "done", reason: "stop" }),
      }),
    })

    const res = await app.fetch(
      new Request("http://local/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", prompt: "Ping" }),
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/event-stream")
    expect(saved).toEqual([{ refresh: "r2", access: "a2", expires: 2, accountId: "acct_1" }])
    expect(await collect(res)).toBe(
      'event: part\ndata: {"type":"text","text":"hello"}\n\nevent: part\ndata: {"type":"done","reason":"stop"}\n\n',
    )
  })

  test("returns 400 for invalid prompt input", async () => {
    const app = createSampleApp({ env: {} })
    const res = await app.fetch(
      new Request("http://local/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex" }),
      }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "prompt is required" })
  })
})
