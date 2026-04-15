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
})
