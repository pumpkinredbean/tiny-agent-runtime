import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { authFile, getAuth, parse, setAuth } from "./store"

const dirs: string[] = []

afterEach(async () => {
  delete process.env.RUNTIME_AUTH_PATH
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runtime auth store", () => {
  test("parses provider auth entries", () => {
    expect(
      parse(
        JSON.stringify({
          copilot: {
            refresh: "r1",
            access: "a1",
            expires: 1,
            enterpriseUrl: "github.example.com",
          },
          codex: {
            refresh: "r2",
            access: "a2",
            expires: 2,
            accountId: "acct_1",
          },
          bad: {
            value: "x",
          },
        }),
      ),
    ).toEqual({
      copilot: {
        refresh: "r1",
        access: "a1",
        expires: 1,
        enterpriseUrl: "github.example.com",
      },
      codex: {
        refresh: "r2",
        access: "a2",
        expires: 2,
        accountId: "acct_1",
      },
    })
  })

  test("writes and reads auth entries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-auth-"))
    dirs.push(dir)
    process.env.RUNTIME_AUTH_PATH = path.join(dir, "auth.json")

    await setAuth("codex", {
      refresh: "r1",
      access: "a1",
      expires: 1,
      accountId: "acct_1",
    })

    await setAuth("copilot", {
      refresh: "r2",
      access: "a2",
      expires: 2,
      enterpriseUrl: "github.example.com",
    })

    expect(authFile()).toBe(path.join(dir, "auth.json"))
    expect(await getAuth("codex")).toEqual({
      refresh: "r1",
      access: "a1",
      expires: 1,
      accountId: "acct_1",
    })
    expect(await getAuth("copilot")).toEqual({
      refresh: "r2",
      access: "a2",
      expires: 2,
      enterpriseUrl: "github.example.com",
    })
  })

  test("preserves unrelated auth entries when writing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiny-agent-runtime-auth-"))
    dirs.push(dir)
    const target = path.join(dir, "auth.json")
    process.env.RUNTIME_AUTH_PATH = target
    await writeFile(
      target,
      JSON.stringify({
        anthropic: {
          access: "a0",
        },
      }),
    )

    await setAuth("codex", {
      refresh: "r1",
      access: "a1",
      expires: 1,
    })

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      anthropic: {
        access: "a0",
      },
      codex: {
        refresh: "r1",
        access: "a1",
        expires: 1,
      },
    })
  })

})
