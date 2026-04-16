import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setAuth } from "../auth/store"
import { codex } from "../providers/codex/provider"

const dirs: string[] = []
const prompt = codex.prompt
const stdout = process.stdout.write.bind(process.stdout)
const stderr = process.stderr.write.bind(process.stderr)
const readlineAnswers: string[] = []
const stdoutChunks: string[] = []
const consoleErrors: string[] = []
const consoleLogs: string[] = []

type ChatHarness = {
  calls: Array<{ model: string; sessionId?: string; msg: Array<Record<string, unknown>> }>
}

async function temp(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function readAuth(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
}

async function* failingEvents(message: string) {
  yield { type: "text" as const, text: "partial" }
  throw new Error(message)
}

function output(chunks: string[]) {
  return chunks.join("")
}

async function cli() {
  return await import("./tart")
}

function queueReadline(answers: string[]) {
  readlineAnswers.splice(0, readlineAnswers.length, ...answers)
}

function stubRandom(ids: string[]) {
  spyOn(crypto, "randomUUID").mockImplementation(() => (ids.shift() ?? "run_fallback-0000-0000-0000-000000000000") as ReturnType<typeof crypto.randomUUID>)
}

function harness(outputs: string[]): ChatHarness {
  const calls: ChatHarness["calls"] = []
  codex.prompt = (async (_auth, input) => {
    calls.push({
      model: input.model,
      sessionId: input.sessionId,
      msg: input.msg as Array<Record<string, unknown>>,
    })
    const text = outputs.shift() ?? "done"
    return {
      auth: { refresh: "refresh-old", access: "access-old", expires: 1, accountId: "acct-old" },
      model: input.model,
      url: "https://example.test",
      events: parts({ type: "text", text }, { type: "done", reason: "stop" }),
    }
  }) as typeof codex.prompt

  return { calls }
}

async function* parts(...items: Array<{ type: "text"; text: string } | { type: "done"; reason: "stop" }>) {
  for (const item of items) yield item
}

beforeEach(() => {
  stdoutChunks.length = 0
  consoleErrors.length = 0
  consoleLogs.length = 0
  mock.module("node:readline/promises", () => ({
    createInterface: () => ({
      question: async () => readlineAnswers.shift() ?? "exit",
      close() {},
    }),
  }))
  spyOn(process.stdout, "write").mockImplementation(
    ((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk))
      return stdout(chunk)
    }) as typeof process.stdout.write,
  )
  spyOn(process.stderr, "write").mockImplementation(
    ((chunk: string | Uint8Array) => {
      return stderr(chunk)
    }) as typeof process.stderr.write,
  )
  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => String(arg)).join(" "))
  })
  spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    consoleLogs.push(args.map((arg) => String(arg)).join(" "))
  })
})

afterEach(async () => {
  mock.restore()
  codex.prompt = prompt
  delete process.env.RUNTIME_AUTH_PATH
  delete process.env.RUNTIME_SESSION_PATH
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("tart --help and --version", () => {
  test("--help prints global help and exits 0", async () => {
    const result = await (await cli()).main(["--help"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toContain("tart")
    expect(out).toContain("login")
    expect(out).toContain("prompt")
    expect(out).toContain("chat")
  })

  test("-h prints global help and exits 0", async () => {
    const result = await (await cli()).main(["-h"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toContain("tart")
  })

  test("--version prints version string and exits 0", async () => {
    const result = await (await cli()).main(["--version"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toMatch(/\d+\.\d+\.\d+/)
  })

  test("-V prints version string and exits 0", async () => {
    const result = await (await cli()).main(["-V"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toMatch(/\d+\.\d+\.\d+/)
  })

  test("login --help prints login help and exits 0", async () => {
    const result = await (await cli()).main(["login", "--help"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toContain("copilot")
    expect(out).toContain("codex")
  })

  test("prompt --help prints prompt help and exits 0", async () => {
    const result = await (await cli()).main(["prompt", "--help"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toContain("--model")
    expect(out).toContain("--system")
  })

  test("chat --help prints chat help and exits 0", async () => {
    const result = await (await cli()).main(["chat", "--help"])
    expect(result).toBe(0)
    const out = consoleLogs.join("")
    expect(out).toContain("--session")
    expect(out).toContain("exit")
  })
})

describe("tart codex auth persistence", () => {
  test("prompt persists refreshed codex auth before stream failure", async () => {
    const dir = await temp("tiny-agent-runtime-cli-auth-")
    const authPath = path.join(dir, "auth.json")
    process.env.RUNTIME_AUTH_PATH = authPath

    await setAuth("codex", {
      refresh: "refresh-old",
      access: "access-old",
      expires: 1,
      accountId: "acct-old",
    })

    codex.prompt = (async () => ({
      auth: {
        refresh: "refresh-new",
        access: "access-new",
        expires: 2,
        accountId: "acct-new",
      },
      model: "gpt-5.4-mini",
      url: "https://chatgpt.com/backend-api/codex/responses",
      events: failingEvents("stream failed"),
    })) as typeof codex.prompt

    await expect((await cli()).main(["prompt", "codex", "hello"])).rejects.toThrow("stream failed")

    expect(await readAuth(authPath)).toEqual({
      codex: {
        refresh: "refresh-new",
        access: "access-new",
        expires: 2,
        accountId: "acct-new",
      },
    })
  })

  test("chat persists refreshed codex auth before stream failure", async () => {
    const dir = await temp("tiny-agent-runtime-cli-chat-")
    const authPath = path.join(dir, "auth.json")
    process.env.RUNTIME_AUTH_PATH = authPath
    process.env.RUNTIME_SESSION_PATH = path.join(dir, "sessions")

    await setAuth("codex", {
      refresh: "refresh-old",
      access: "access-old",
      expires: 1,
      accountId: "acct-old",
    })

    codex.prompt = (async () => ({
      auth: {
        refresh: "refresh-new",
        access: "access-new",
        expires: 2,
        accountId: "acct-new",
      },
      model: "gpt-5.4-mini",
      url: "https://chatgpt.com/backend-api/codex/responses",
      events: failingEvents("chat stream failed"),
    })) as typeof codex.prompt

    queueReadline(["exit"])

    await expect((await cli()).main(["chat", "codex", "hello"])).rejects.toThrow("chat stream failed")

    expect(await readAuth(authPath)).toEqual({
      codex: {
        refresh: "refresh-new",
        access: "access-new",
        expires: 2,
        accountId: "acct-new",
      },
    })
  })

  test("chat persists multi-turn transcript and resumes with --session", async () => {
    const dir = await temp("tiny-agent-runtime-cli-resume-")
    process.env.RUNTIME_AUTH_PATH = path.join(dir, "auth.json")
    process.env.RUNTIME_SESSION_PATH = path.join(dir, "sessions")

    await setAuth("codex", {
      refresh: "refresh-old",
      access: "access-old",
      expires: 1,
      accountId: "acct-old",
    })

    stubRandom(["cli-session-1", "run-1", "run-2", "run-3"])
    queueReadline(["Second turn", "exit"])
    const first = harness(["First answer", "Second answer"])

    await expect((await cli()).main(["chat", "codex", "First turn"])).resolves.toBe(0)

    expect(first.calls).toEqual([
      {
        model: first.calls[0]?.model,
        sessionId: "cli-session-1",
        msg: [{ role: "user", content: "First turn" }],
      },
      {
        model: first.calls[1]?.model,
        sessionId: "cli-session-1",
        msg: [
          { role: "user", content: "First turn" },
          { role: "assistant", content: "First answer" },
          { role: "user", content: "Second turn" },
        ],
      },
    ])

    queueReadline(["exit"])
    const second = harness(["Resumed answer"])

    await expect((await cli()).main(["chat", "codex", "--session", "cli-session-1", "Third turn"])).resolves.toBe(0)

    expect(second.calls).toEqual([
      {
        model: second.calls[0]?.model,
        sessionId: "cli-session-1",
        msg: [
          { role: "user", content: "First turn" },
          { role: "assistant", content: "First answer" },
          { role: "user", content: "Second turn" },
          { role: "assistant", content: "Second answer" },
          { role: "user", content: "Third turn" },
        ],
      },
    ])
  })

  test("prompt writes usage summary to stderr only", async () => {
    const dir = await temp("tiny-agent-runtime-cli-usage-")
    process.env.RUNTIME_AUTH_PATH = path.join(dir, "auth.json")

    await setAuth("codex", {
      refresh: "refresh-old",
      access: "access-old",
      expires: Date.now() + 60_000,
      accountId: "acct-old",
    })

    codex.prompt = (async () => ({
      auth: {
        refresh: "refresh-old",
        access: "access-old",
        expires: Date.now() + 60_000,
        accountId: "acct-old",
      },
      model: "gpt-5.4-mini",
      url: "https://chatgpt.com/backend-api/codex/responses",
      events: (async function* () {
        yield { type: "text" as const, text: "hello" }
        yield { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cost: { usd: 0.12 } } }
        yield { type: "done" as const, reason: "stop" }
      })(),
    })) as typeof codex.prompt

    await expect((await cli()).main(["prompt", "codex", "hello"])).resolves.toBe(0)

    expect(output(stdoutChunks)).toContain("hello\n")
    expect(output(stdoutChunks)).not.toContain("run usage")
    expect(output(consoleErrors)).toContain('run usage input=10 output=4 total=14 cost={"usd":0.12}')
  })

  test("chat writes per-turn usage summary to stderr only", async () => {
    const dir = await temp("tiny-agent-runtime-cli-chat-usage-")
    process.env.RUNTIME_AUTH_PATH = path.join(dir, "auth.json")
    process.env.RUNTIME_SESSION_PATH = path.join(dir, "sessions")

    await setAuth("codex", {
      refresh: "refresh-old",
      access: "access-old",
      expires: Date.now() + 60_000,
      accountId: "acct-old",
    })

    codex.prompt = (async (_auth, input) => ({
      auth: {
        refresh: "refresh-old",
        access: "access-old",
        expires: Date.now() + 60_000,
        accountId: "acct-old",
      },
      model: input.model,
      url: "https://chatgpt.com/backend-api/codex/responses",
      events: (async function* () {
        yield { type: "text" as const, text: "reply" }
        yield { type: "usage" as const, usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
        yield { type: "done" as const, reason: "stop" }
      })(),
    })) as typeof codex.prompt

    queueReadline(["exit"])

    await expect((await cli()).main(["chat", "codex", "hello"])).resolves.toBe(0)

    expect(output(stdoutChunks)).toContain("reply\n")
    expect(output(stdoutChunks)).not.toContain("turn usage")
    expect(output(consoleErrors)).toContain("turn usage input=8 output=2 total=10")
  })
})
