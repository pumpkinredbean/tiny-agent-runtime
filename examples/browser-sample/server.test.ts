import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSessionStore, type Part } from "../../src/index"
import { createSampleApp, exampleToolRegistry, parsePromptRequest } from "./server"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function collect(res: Response) {
  return await res.text()
}

async function* parts(...items: Part[]) {
  for (const item of items) yield item
}

describe("sample prompt request parsing", () => {
  test("exposes example-only tool registry wiring", () => {
    expect(exampleToolRegistry.list().map((item) => item.name)).toEqual(["weather"])
  })

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
      sessionId: undefined,
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
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-session-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z", createId: () => "session_1" })
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
        events: parts(
          { type: "text", text: "hello" },
          { type: "usage", usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } },
          { type: "done", reason: "stop" },
        ),
      }),
      sessionStore: store,
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
      'event: session\ndata: {"id":"session_1"}\n\nevent: part\ndata: {"type":"text","text":"hello"}\n\nevent: part\ndata: {"type":"usage","usage":{"inputTokens":12,"outputTokens":3,"totalTokens":15}}\n\nevent: part\ndata: {"type":"done","reason":"stop"}\n\n',
    )
    await expect(store.get("session_1")).resolves.toEqual({
      id: "session_1",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      transcript: [
        { role: "user", content: "Ping" },
        { role: "assistant", content: "hello" },
      ],
      runs: [
        {
          id: "session_1",
          at: "2026-04-15T00:00:00.000Z",
          provider: "codex",
          model: "gpt-5.4-mini",
        },
      ],
    })
  })

  test("resumes an existing session and ignores replacement history", async () => {
    const calls: Array<Array<Record<string, unknown>>> = []
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-resume-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z", createId: () => "run_1" })
    await store.create("session_resume")
    await store.appendMessage("session_resume", { role: "user", content: "Earlier user" })
    await store.appendMessage("session_resume", { role: "assistant", content: "Earlier assistant" })

    const trackingApp = createSampleApp({
      env: {},
      getAuth: async () => ({ refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" }),
      codexPrompt: async (_auth, input) => {
        calls.push(input.msg as Array<Record<string, unknown>>)
        return {
          auth: { refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" },
          model: "gpt-5.4-mini",
          url: "https://example.test",
          events: parts({ type: "text", text: "Resumed answer" }, { type: "done", reason: "stop" }),
        }
      },
      sessionStore: store,
    })

    const res = await trackingApp.fetch(
      new Request("http://local/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "codex",
          sessionId: "session_resume",
          prompt: "Next prompt",
          history: [{ role: "user", content: "Ignored history" }],
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await collect(res)).toBe(
      'event: session\ndata: {"id":"session_resume"}\n\nevent: part\ndata: {"type":"text","text":"Resumed answer"}\n\nevent: part\ndata: {"type":"done","reason":"stop"}\n\n',
    )
    expect(calls).toEqual([
      [
        { role: "user", content: "Earlier user" },
        { role: "assistant", content: "Earlier assistant" },
        { role: "user", content: "Next prompt" },
      ],
    ])
  })

  test("persists partial output on stream failure so the session can recover", async () => {
    const calls: Array<Array<Record<string, unknown>>> = []
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-recovery-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z", createId: () => "run_1" })
    let fail = true
    const app = createSampleApp({
      env: {},
      getAuth: async () => ({ refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" }),
      codexPrompt: async (_auth, input) => {
        calls.push(input.msg as Array<Record<string, unknown>>)
        if (fail) {
          return {
            auth: { refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" },
            model: "gpt-5.4-mini",
            url: "https://example.test",
            events: (async function* () {
              yield { type: "text" as const, text: "partial" }
              throw new Error("stream failed")
            })(),
          }
        }
        return {
          auth: { refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" },
          model: "gpt-5.4-mini",
          url: "https://example.test",
          events: parts({ type: "text", text: "Recovered" }, { type: "done", reason: "stop" }),
        }
      },
      sessionStore: store,
    })

    const failed = await app.fetch(
      new Request("http://local/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", sessionId: "session_recovery", prompt: "First prompt" }),
      }),
    )

    expect(await collect(failed)).toBe(
      'event: session\ndata: {"id":"session_recovery"}\n\nevent: part\ndata: {"type":"text","text":"partial"}\n\nevent: part\ndata: {"type":"error","text":"stream failed"}\n\n',
    )
    await expect(store.get("session_recovery")).resolves.toEqual({
      id: "session_recovery",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      transcript: [
        { role: "user", content: "First prompt" },
        { role: "assistant", content: "partial" },
      ],
      runs: [
        {
          id: "run_1",
          at: "2026-04-15T00:00:00.000Z",
          provider: "codex",
          model: "gpt-5.4-mini",
        },
      ],
    })

    fail = false
    const resumed = await app.fetch(
      new Request("http://local/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", sessionId: "session_recovery", prompt: "Second prompt" }),
      }),
    )

    expect(await collect(resumed)).toBe(
      'event: session\ndata: {"id":"session_recovery"}\n\nevent: part\ndata: {"type":"text","text":"Recovered"}\n\nevent: part\ndata: {"type":"done","reason":"stop"}\n\n',
    )
    expect(calls).toEqual([
      [{ role: "user", content: "First prompt" }],
      [
        { role: "user", content: "First prompt" },
        { role: "assistant", content: "partial" },
        { role: "user", content: "Second prompt" },
      ],
    ])
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
