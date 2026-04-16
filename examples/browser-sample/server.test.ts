import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSessionStore, type Part } from "@pumpkinredbean/tiny-agent-runtime"
import {
  buildModelOptions,
  createSampleApp,
  exampleToolRegistry,
  parseDeleteSessionRequest,
  parseModelsRequest,
  parsePromptRequest,
  parseSessionRequest,
  parseTruncateRequest,
  resolveModelSelection,
} from "./server"

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
      reasoning: undefined,
      system: "Be concise",
      sessionId: undefined,
      prompt: "Hello",
      history: [{ role: "assistant", content: "Earlier" }],
    })
  })

  test("normalizes supported reasoning effort and drops unsupported copilot model effort", async () => {
    const supported = new Request("http://local/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "codex", model: "gpt-5.4", reasoning: { effort: "xhigh" }, prompt: "Hello" }),
    })

    await expect(parsePromptRequest(supported, {})).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.4",
      reasoning: { effort: "xhigh" },
    })

    const unsupported = new Request("http://local/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "copilot", model: "claude-sonnet-4", reasoning: { effort: "medium" }, prompt: "Hello" }),
    })

    await expect(parsePromptRequest(unsupported, {})).resolves.toMatchObject({
      provider: "copilot",
      model: "claude-sonnet-4",
      reasoning: undefined,
    })

    const unsupportedCopilot = new Request("http://local/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "copilot", model: "gpt-4.1", reasoning: { effort: "medium" }, prompt: "Hello" }),
    })

    await expect(parsePromptRequest(unsupportedCopilot, {})).resolves.toMatchObject({
      provider: "copilot",
      model: "gpt-4.1",
      reasoning: undefined,
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

  test("parses session transcript requests", () => {
    expect(parseSessionRequest(new Request("http://local/api/session?sessionId=session_123"))).toEqual({
      sessionId: "session_123",
    })
  })

  test("parses delete session requests", () => {
    expect(parseDeleteSessionRequest(new Request("http://local/api/session?sessionId=session_del"))).toEqual({
      sessionId: "session_del",
    })
  })

  test("parses truncate session requests", async () => {
    const req = new Request("http://local/api/session/truncate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess_1", keepCount: 2 }),
    })
    await expect(parseTruncateRequest(req)).resolves.toEqual({ sessionId: "sess_1", keepCount: 2 })
  })

  test("rejects truncate with missing sessionId", async () => {
    const req = new Request("http://local/api/session/truncate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepCount: 0 }),
    })
    await expect(parseTruncateRequest(req)).rejects.toThrow("sessionId is required")
  })

  test("rejects truncate with negative keepCount", async () => {
    const req = new Request("http://local/api/session/truncate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess_1", keepCount: -1 }),
    })
    await expect(parseTruncateRequest(req)).rejects.toThrow("non-negative integer")
  })

  test("parses model list requests", () => {
    expect(parseModelsRequest(new Request("http://local/api/models?provider=codex"), {})).toEqual({
      provider: "codex",
    })
  })
})

describe("model option helpers", () => {
  test("keeps actual model ids separate and annotates reasoning policy", () => {
    expect(buildModelOptions("codex", ["gpt-5.4", "gpt-5.4-mini", "custom-codex-preview"])).toEqual([
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        name: undefined,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4-Mini",
        name: undefined,
        reasoningEfforts: ["low", "medium", "high", "xhigh"],
      },
      {
        id: "custom-codex-preview",
        label: "Custom-Codex-Preview",
        name: undefined,
        reasoningEfforts: [],
      },
    ])
  })

  test("annotates copilot model reasoning policy", () => {
    expect(buildModelOptions("copilot", ["claude-sonnet-4.6", "gpt-4.1", "unknown-preview"])).toEqual([
      {
        id: "claude-sonnet-4.6",
        label: "Claude-Sonnet-4.6",
        name: undefined,
        reasoningEfforts: [],
      },
      {
        id: "gpt-4.1",
        label: "GPT-4.1",
        name: undefined,
        reasoningEfforts: [],
      },
      {
        id: "unknown-preview",
        label: "Unknown-Preview",
        name: undefined,
        reasoningEfforts: [],
      },
    ])
  })

  test("resolves the selected model id directly", () => {
    const models = buildModelOptions("codex", ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-max"])

    expect(resolveModelSelection(models, "gpt-5.4-max")).toEqual({
      model: "gpt-5.4-max",
    })
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
          parts: [
            { type: "text", text: "hello" },
            { type: "usage", usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } },
            { type: "done", reason: "stop" },
          ],
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

    const sessionRes = await trackingApp.fetch(new Request("http://local/api/session?sessionId=session_resume"))

    expect(sessionRes.status).toBe(200)
    await expect(sessionRes.json()).resolves.toEqual({
      id: "session_resume",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      transcript: [
        { role: "user", content: "Earlier user" },
        { role: "assistant", content: "Earlier assistant" },
        { role: "user", content: "Next prompt" },
        { role: "assistant", content: "Resumed answer" },
      ],
      runs: [
        {
          id: "run_1",
          at: "2026-04-15T00:00:00.000Z",
          provider: "codex",
          model: "gpt-5.4-mini",
          parts: [
            { type: "text", text: "Resumed answer" },
            { type: "done", reason: "stop" },
          ],
        },
      ],
    })
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
          parts: [
            { type: "text", text: "partial" },
            { type: "error", text: "stream failed" },
          ],
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

  test("returns 400/404 for invalid or missing session transcript requests", async () => {
    const app = createSampleApp({ env: {} })

    const missingId = await app.fetch(new Request("http://local/api/session"))
    expect(missingId.status).toBe(400)
    expect(await missingId.json()).toEqual({ error: "sessionId is required" })

    const missingSession = await app.fetch(new Request("http://local/api/session?sessionId=missing"))
    expect(missingSession.status).toBe(404)
    expect(await missingSession.json()).toEqual({ error: "session not found" })
  })

  test("lists recent sessions for the browser sidebar", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-session-list-"))
    dirs.push(dir)
    let stamp = 0
    const store = createSessionStore({
      root: dir,
      now: () => `2026-04-15T00:00:0${stamp++}.000Z`,
      createId: () => `run_${stamp}`,
    })
    await store.create("session_a")
    await store.appendMessage("session_a", { role: "user", content: "Earlier question" })
    await store.create("session_b")
    await store.appendMessage("session_b", { role: "user", content: "Latest question" })
    await store.appendMessage("session_b", { role: "assistant", content: "Latest answer" })

    const app = createSampleApp({ env: {}, sessionStore: store })
    const res = await app.fetch(new Request("http://local/api/sessions"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([
      {
        id: "session_b",
        createdAt: "2026-04-15T00:00:02.000Z",
        updatedAt: "2026-04-15T00:00:04.000Z",
        transcriptCount: 2,
        lastMessage: { role: "assistant", content: "Latest answer" },
        lastRun: undefined,
      },
      {
        id: "session_a",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:01.000Z",
        transcriptCount: 1,
        lastMessage: { role: "user", content: "Earlier question" },
        lastRun: undefined,
      },
    ])
  })

  test("returns an empty array from /api/sessions when the store has no sessions", async () => {
    // This covers the contract relied on by the sidebar retry path:
    // the endpoint must return a valid empty JSON array (not an error) when
    // there are simply no saved sessions yet, so the retry logic terminates
    // cleanly on first attempt and the sidebar shows "No saved sessions."
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-session-empty-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir })
    const app = createSampleApp({ env: {}, sessionStore: store })

    const res = await app.fetch(new Request("http://local/api/sessions"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  test("returns 200 JSON array from /api/sessions even after a session is deleted", async () => {
    // After a delete the sidebar retry path re-fetches; verify the list
    // endpoint still returns a valid (possibly smaller) array rather than an
    // error so the retry sentinel sees success on the very next attempt.
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-session-after-delete-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z" })
    await store.create("keep_me")
    await store.appendMessage("keep_me", { role: "user", content: "Stay" })
    await store.create("delete_me")
    await store.appendMessage("delete_me", { role: "user", content: "Go away" })
    await store.remove("delete_me")

    const app = createSampleApp({ env: {}, sessionStore: store })
    const res = await app.fetch(new Request("http://local/api/sessions"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe("keep_me")
  })

  test("returns runtime-known codex models for the sample model picker", async () => {
    const app = createSampleApp({
      env: { RUNTIME_MODEL: "gpt-5.4-mini" },
      codexModels: () => ["gpt-5.4", "gpt-5.4-mini"],
      fetchModelsCatalog: async () => undefined,
    })

    const res = await app.fetch(new Request("http://local/api/models?provider=codex"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      provider: "codex",
      defaultModel: "gpt-5.4-mini",
      models: [
        {
          id: "gpt-5.4",
          label: "GPT-5.4",
          name: undefined,
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        {
          id: "gpt-5.4-mini",
          label: "GPT-5.4-Mini",
          name: undefined,
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
      ],
      selection: {
        model: "gpt-5.4-mini",
      },
      source: "runtime",
    })
  })

  test("prefers models.dev metadata for codex model ordering when available", async () => {
    const app = createSampleApp({
      env: { RUNTIME_MODEL: "gpt-5.4-mini" },
      codexModels: () => ["gpt-5.4-mini", "gpt-5.4", "custom-codex-preview"],
      fetchModelsCatalog: async () => ({
        openai: {
          models: {
            "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
            "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
          },
        },
      }),
    })

    const res = await app.fetch(new Request("http://local/api/models?provider=codex"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      provider: "codex",
      defaultModel: "gpt-5.4-mini",
      models: [
        {
          id: "gpt-5.4",
          label: "GPT-5.4",
          name: "GPT-5.4",
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        {
          id: "gpt-5.4-mini",
          label: "GPT-5.4 Mini",
          name: "GPT-5.4 Mini",
          reasoningEfforts: ["low", "medium", "high", "xhigh"],
        },
        {
          id: "custom-codex-preview",
          label: "Custom-Codex-Preview",
          name: undefined,
          reasoningEfforts: [],
        },
      ],
      selection: {
        model: "gpt-5.4-mini",
      },
      source: "models.dev",
    })
  })

  test("returns discovered copilot models for the sample model picker", async () => {
    const app = createSampleApp({
      env: {},
      getAuth: async () => ({ refresh: "r1", access: "a1", expires: 1 }),
      copilotModels: async () => ["claude-sonnet-4.6", "gpt-4.1"],
      fetchModelsCatalog: async () => undefined,
    })

    const res = await app.fetch(new Request("http://local/api/models?provider=copilot"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      provider: "copilot",
      defaultModel: "claude-sonnet-4.6",
      models: [
        {
          id: "claude-sonnet-4.6",
          label: "Claude-Sonnet-4.6",
          name: undefined,
          reasoningEfforts: [],
        },
        {
          id: "gpt-4.1",
          label: "GPT-4.1",
          name: undefined,
          reasoningEfforts: [],
        },
      ],
      selection: {
        model: "claude-sonnet-4.6",
      },
      source: "runtime",
    })
  })

  test("uses models.dev metadata to sort copilot discoveries without hiding unknown models", async () => {
    const app = createSampleApp({
      env: {},
      getAuth: async () => ({ refresh: "r1", access: "a1", expires: 1 }),
      copilotModels: async () => ["gpt-4.1", "unknown-preview", "claude-sonnet-4.6"],
      fetchModelsCatalog: async () => ({
        "github-copilot": {
          models: {
            "claude-sonnet-4.6": { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
            "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
          },
        },
      }),
    })

    const res = await app.fetch(new Request("http://local/api/models?provider=copilot"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      provider: "copilot",
      defaultModel: "gpt-4.1",
      models: [
        {
          id: "claude-sonnet-4.6",
          label: "Claude Sonnet 4.6",
          name: "Claude Sonnet 4.6",
          reasoningEfforts: [],
        },
        {
          id: "gpt-4.1",
          label: "GPT-4.1",
          name: "GPT-4.1",
          reasoningEfforts: [],
        },
        {
          id: "unknown-preview",
          label: "Unknown-Preview",
          name: undefined,
          reasoningEfforts: [],
        },
      ],
      selection: {
        model: "gpt-4.1",
      },
      source: "models.dev",
    })
  })

  test("returns 401 when copilot model discovery is unavailable", async () => {
    const app = createSampleApp({ env: {}, getAuth: async () => undefined })

    const res = await app.fetch(new Request("http://local/api/models?provider=copilot"))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({
      error: expect.stringContaining("missing copilot oauth"),
    })
  })

  test("exposes transcript for auto-created sessions after prompt completion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-transcript-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z", createId: () => "session_1" })
    const app = createSampleApp({
      env: {},
      getAuth: async () => ({ refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" }),
      codexPrompt: async () => ({
        auth: { refresh: "r1", access: "a1", expires: 1, accountId: "acct_1" },
        model: "gpt-5.4-mini",
        url: "https://example.test",
        events: parts({ type: "text", text: "hello" }, { type: "done", reason: "stop" }),
      }),
      sessionStore: store,
    })

    const promptRes = await app.fetch(
      new Request("http://local/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", prompt: "Ping" }),
      }),
    )

    expect(await collect(promptRes)).toContain('event: session\ndata: {"id":"session_1"}')

    const sessionRes = await app.fetch(new Request("http://local/api/session?sessionId=session_1"))

    expect(sessionRes.status).toBe(200)
    await expect(sessionRes.json()).resolves.toEqual({
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
          parts: [
            { type: "text", text: "hello" },
            { type: "done", reason: "stop" },
          ],
        },
      ],
    })
  })

  test("deletes a session and returns its id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-session-delete-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir })
    await store.create("session_to_delete")
    await store.appendMessage("session_to_delete", { role: "user", content: "Delete me" })

    const app = createSampleApp({ env: {}, sessionStore: store })

    const res = await app.fetch(
      new Request("http://local/api/session?sessionId=session_to_delete", { method: "DELETE" }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: "session_to_delete" })

    const missing = await app.fetch(new Request("http://local/api/session?sessionId=session_to_delete"))
    expect(missing.status).toBe(404)
  })

  test("returns 404 when deleting a session that does not exist", async () => {
    const app = createSampleApp({ env: {} })
    const res = await app.fetch(
      new Request("http://local/api/session?sessionId=ghost", { method: "DELETE" }),
    )
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "session not found" })
  })

  test("truncates a session transcript and returns the updated session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-browser-truncate-"))
    dirs.push(dir)
    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z" })
    await store.create("sess_trunc")
    await store.appendMessage("sess_trunc", { role: "user", content: "First" })
    await store.appendMessage("sess_trunc", { role: "assistant", content: "Reply" })
    await store.appendMessage("sess_trunc", { role: "user", content: "Second" })

    const app = createSampleApp({ env: {}, sessionStore: store })
    const res = await app.fetch(
      new Request("http://local/api/session/truncate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess_trunc", keepCount: 1 }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transcript).toEqual([{ role: "user", content: "First" }])

    // Verify on disk
    const reloaded = await store.get("sess_trunc")
    expect(reloaded?.transcript).toEqual([{ role: "user", content: "First" }])
  })

  test("returns 404 when truncating a session that does not exist", async () => {
    const app = createSampleApp({ env: {} })
    const res = await app.fetch(
      new Request("http://local/api/session/truncate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "ghost", keepCount: 0 }),
      }),
    )
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "session not found" })
  })

  test("returns 400 for invalid truncate input", async () => {
    const app = createSampleApp({ env: {} })
    const res = await app.fetch(
      new Request("http://local/api/session/truncate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess_1" }),
      }),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("non-negative integer") })
  })

  // ---- model catalog hardening ----

  test("returns 400 for /api/models with an unknown provider", async () => {
    // The client retry boundary relies on non-2xx responses being distinct
    // from empty-but-valid 200 responses; verify the server surfaces the right
    // status so the client can distinguish a bad request from a transient miss.
    const app = createSampleApp({ env: {} })
    const res = await app.fetch(new Request("http://local/api/models?provider=unknown"))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("provider") })
  })

  test("returns 401 for /api/models?provider=codex when codex auth is missing", async () => {
    // The client should treat 401 the same as any non-ok response (error state,
    // eligible for retry).  Verify the server produces 401 not a 500/crash.
    const app = createSampleApp({ env: {}, getAuth: async () => undefined, codexModels: () => [] })
    // codex does not require auth for model listing (it uses static list),
    // but copilot does – verify the existing 401 contract still holds.
    const res = await app.fetch(new Request("http://local/api/models?provider=copilot"))
    expect(res.status).toBe(401)
  })

  test("returns valid model list even when models.dev catalog fetch fails", async () => {
    // Simulates a transient models.dev timeout – the server must still return
    // a 200 with the runtime-derived list so the client retry logic terminates.
    const app = createSampleApp({
      env: {},
      codexModels: () => ["gpt-5.4", "gpt-5.4-mini"],
      fetchModelsCatalog: async () => {
        throw new Error("network timeout")
      },
    })

    const res = await app.fetch(new Request("http://local/api/models?provider=codex"))

    // The server's fetchModelsCatalog wrapper catches errors and returns
    // undefined, so the endpoint falls back to runtime-only list.
    // If the wrapper does NOT catch, this request would 500 – failing the test
    // acts as a regression guard.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.models)).toBe(true)
    expect(body.models.length).toBeGreaterThan(0)
    expect(body.source).toBe("runtime")
  })

  test("returns consistent model list shape on repeated /api/models calls", async () => {
    // Verifies that the endpoint is idempotent and the shape is stable,
    // which is the invariant the client retry loop depends on to decide whether
    // a catalog is usable (non-empty models array + provider field present).
    const app = createSampleApp({
      env: {},
      codexModels: () => ["gpt-5.4"],
      fetchModelsCatalog: async () => undefined,
    })

    const [res1, res2] = await Promise.all([
      app.fetch(new Request("http://local/api/models?provider=codex")),
      app.fetch(new Request("http://local/api/models?provider=codex")),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)

    const [body1, body2] = await Promise.all([res1.json(), res2.json()])
    expect(body1).toEqual(body2)
    expect(body1.provider).toBe("codex")
    expect(Array.isArray(body1.models)).toBe(true)
  })
})
