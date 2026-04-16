import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSessionStore } from "./session-store"

const dirs: string[] = []

afterEach(async () => {
  delete process.env.RUNTIME_SESSION_PATH
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("session store", () => {
  test("persists transcript and run metadata in separate records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-"))
    dirs.push(dir)

    let stamp = 0
    let ident = 0
    const store = createSessionStore({
      root: dir,
      now: () => `2026-04-15T00:00:0${stamp++}.000Z`,
      createId: () => `id_${ident++}`,
    })

    const session = await store.create()
    await store.appendMessage(session.id, { role: "user", content: "Hello" })
    await store.appendMessage(session.id, { role: "assistant", content: "Hi" })
    await store.appendRun(session.id, { provider: "codex", model: "gpt-5.4-mini", system: "Be concise" })

    await expect(store.get(session.id)).resolves.toEqual({
      id: "id_0",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:04.000Z",
      transcript: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
      runs: [
        {
          id: "id_1",
          at: "2026-04-15T00:00:03.000Z",
          provider: "codex",
          model: "gpt-5.4-mini",
          system: "Be concise",
        },
      ],
    })
  })

  test("lists recent sessions with summary metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-list-"))
    dirs.push(dir)

    let stamp = 0
    const store = createSessionStore({
      root: dir,
      now: () => `2026-04-15T00:00:0${stamp++}.000Z`,
      createId: () => `id_${stamp}`,
    })

    await store.create("older")
    await store.appendMessage("older", { role: "user", content: "Earlier" })
    await store.appendRun("older", { provider: "codex", model: "gpt-5.4-mini" })

    await store.create("newer")
    await store.appendMessage("newer", { role: "user", content: "Latest question" })
    await store.appendMessage("newer", { role: "assistant", content: "Latest answer" })

    await expect(store.list()).resolves.toEqual([
      {
        id: "newer",
        createdAt: "2026-04-15T00:00:04.000Z",
        updatedAt: "2026-04-15T00:00:06.000Z",
        transcriptCount: 2,
        lastMessage: { role: "assistant", content: "Latest answer" },
        lastRun: undefined,
      },
      {
        id: "older",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:03.000Z",
        transcriptCount: 1,
        lastMessage: { role: "user", content: "Earlier" },
        lastRun: {
          id: "id_2",
          at: "2026-04-15T00:00:02.000Z",
          provider: "codex",
          model: "gpt-5.4-mini",
        },
      },
    ])
  })

  test("removes an existing session directory and returns true", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-remove-"))
    dirs.push(dir)

    const store = createSessionStore({ root: dir })
    await store.create("to-delete")
    await store.appendMessage("to-delete", { role: "user", content: "Hello" })

    expect(await store.remove("to-delete")).toBe(true)
    await expect(store.get("to-delete")).resolves.toBeUndefined()
  })

  test("returns false when removing a session that does not exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-remove-miss-"))
    dirs.push(dir)

    const store = createSessionStore({ root: dir })
    expect(await store.remove("nonexistent")).toBe(false)
  })

  test("truncates transcript to the given count and preserves earlier messages", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-truncate-"))
    dirs.push(dir)

    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z" })
    await store.create("sess-trunc")
    await store.appendMessage("sess-trunc", { role: "user", content: "First" })
    await store.appendMessage("sess-trunc", { role: "assistant", content: "Reply" })
    await store.appendMessage("sess-trunc", { role: "user", content: "Second" })
    await store.appendMessage("sess-trunc", { role: "assistant", content: "Reply 2" })

    const result = await store.truncateTranscript("sess-trunc", 2)
    expect(result?.transcript).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "Reply" },
    ])

    // Persisted on disk too
    const reloaded = await store.get("sess-trunc")
    expect(reloaded?.transcript).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "Reply" },
    ])
  })

  test("truncate to zero empties the transcript", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-truncate-zero-"))
    dirs.push(dir)

    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z" })
    await store.create("sess-zero")
    await store.appendMessage("sess-zero", { role: "user", content: "Hello" })
    await store.appendMessage("sess-zero", { role: "assistant", content: "Hi" })

    const result = await store.truncateTranscript("sess-zero", 0)
    expect(result?.transcript).toEqual([])

    const reloaded = await store.get("sess-zero")
    expect(reloaded?.transcript).toEqual([])
  })

  test("truncate with keepCount >= length returns session unchanged", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-truncate-noop-"))
    dirs.push(dir)

    const store = createSessionStore({ root: dir, now: () => "2026-04-15T00:00:00.000Z" })
    await store.create("sess-noop")
    await store.appendMessage("sess-noop", { role: "user", content: "Hello" })

    const result = await store.truncateTranscript("sess-noop", 5)
    expect(result?.transcript).toEqual([{ role: "user", content: "Hello" }])
  })

  test("persists run parts when provided and omits the field when absent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-parts-"))
    dirs.push(dir)

    let stamp = 0
    let ident = 0
    const store = createSessionStore({
      root: dir,
      now: () => `2026-04-15T00:00:0${stamp++}.000Z`,
      createId: () => `id_${ident++}`,
    })

    const session = await store.create()
    await store.appendRun(session.id, {
      provider: "codex",
      model: "gpt-5.4-mini",
      parts: [
        { type: "text", text: "Hello" },
        { type: "reasoning", text: "thinking..." },
        { type: "done", reason: "stop" },
      ],
    })
    await store.appendRun(session.id, {
      provider: "codex",
      model: "gpt-5.4-mini",
    })

    const stored = await store.get(session.id)
    expect(stored?.runs[0]?.parts).toEqual([
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "thinking..." },
      { type: "done", reason: "stop" },
    ])
    expect(stored?.runs[1]?.parts).toBeUndefined()
  })

  test("truncateTranscript returns undefined for a nonexistent session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-session-truncate-miss-"))
    dirs.push(dir)

    const store = createSessionStore({ root: dir })
    const result = await store.truncateTranscript("ghost", 0)
    expect(result).toBeUndefined()
  })
})
