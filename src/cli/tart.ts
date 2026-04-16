#!/usr/bin/env node
import { createInterface } from "node:readline/promises"
import { createRequire } from "node:module"
import type { CodexAuth, CopilotAuth } from "../auth/contracts"
import { getAuth, setAuth } from "../auth/store"
import type { Part, ProviderID, Usage } from "../core/contracts"
import { resolveRuntimeModel, changedCodexAuth } from "../core/runtime"
import { createSessionStore } from "../core/session-store"
import { appendAssistantText, appendUserText, createSession, promptMessages, sessionMessages } from "../core/session"
import { formatUsage, mergeUsage } from "../core/usage"
import { copilot } from "../providers/copilot/provider"
import { codex } from "../providers/codex/provider"
import { main as loginCopilot } from "../providers/copilot/auth"
import { main as loginCodex } from "../providers/codex/auth"

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require("../../package.json") as { version: string }
    return pkg.version
  } catch {
    return "0.0.0"
  }
}

const HELP_GLOBAL = `
tart — tiny agent runtime CLI

Usage:
  tart <command> <provider> [options] [args]

Commands:
  login   Authenticate with a provider
  prompt  Send a single prompt and print the response
  chat    Start an interactive chat session

Providers:
  copilot   GitHub Copilot
  codex     OpenAI Codex (ChatGPT)

Options:
  -h, --help      Show this help message
  -V, --version   Print the version number

Run \`tart <command> --help\` for command-specific options.
`.trim()

const HELP_LOGIN = `
Usage:
  tart login <provider>

Providers:
  copilot   Authenticate via GitHub OAuth device flow
  codex     Authenticate via OpenAI / ChatGPT

Options:
  -h, --help   Show this help message
`.trim()

const HELP_PROMPT = `
Usage:
  tart prompt <provider> [options] [text...]

Send a single prompt to the provider and print the streamed response.
If no text is provided, input is read from stdin.

Options:
  --model   MODEL    Override the default model
  --system  TEXT     Set a system prompt
  -h, --help         Show this help message

Examples:
  tart prompt copilot "Explain monads"
  echo "Summarise this" | tart prompt codex
  tart prompt codex --model gpt-4o "Hello"
`.trim()

const HELP_CHAT = `
Usage:
  tart chat <provider> [options] [first-turn text...]

Start an interactive multi-turn chat session.
Type \`exit\` or \`quit\` to end the session.

Options:
  --model    MODEL    Override the default model
  --system   TEXT     Set a system prompt
  --session  ID       Resume an existing session by ID
  -h, --help          Show this help message

Examples:
  tart chat copilot
  tart chat codex --session my-session "Continue from here"
`.trim()

function usage() {
  console.error("Usage: tart <login|prompt|chat> <copilot|codex> [--model MODEL] [--system TEXT] [--session ID] [args]")
}

type Options = {
  model?: string
  system?: string
  session?: string
  args: string[]
}

function parse(args: string[]): Options {
  const next: Options = { args: [] }

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === "--model") {
      next.model = args[index + 1]
      index += 1
      continue
    }
    if (value === "--system") {
      next.system = args[index + 1]
      index += 1
      continue
    }
    if (value === "--session") {
      next.session = args[index + 1]
      index += 1
      continue
    }
    next.args.push(value)
  }

  return next
}

async function stdin() {
  const input = await Bun.stdin.text()
  return input.trim()
}

function text(parts: string[]) {
  return parts.join(" ").trim()
}

type StreamResult = {
  text: string
  usage: Usage
}

function reportUsage(scope: string, usage: Usage) {
  const summary = formatUsage(usage)
  if (summary) console.error(`${scope} usage ${summary}`)
}

async function stream(events: AsyncIterable<Part>): Promise<StreamResult> {
  let out = ""
  let usage = {}
  for await (const part of events) {
    if (part.type === "text") {
      out += part.text
      process.stdout.write(part.text)
    }
    if (part.type === "usage") usage = mergeUsage(usage, part.usage)
    if (part.type === "error") throw new Error(part.text)
  }
  if (out) process.stdout.write("\n")
  return { text: out, usage }
}

async function auth(id: "copilot"): Promise<CopilotAuth | undefined>
async function auth(id: "codex"): Promise<CodexAuth | undefined>
async function auth(id: ProviderID): Promise<CopilotAuth | CodexAuth | undefined>
async function auth(id: ProviderID) {
  return id === "copilot" ? getAuth("copilot") : getAuth("codex")
}

async function saveAuth(id: ProviderID, prev: CopilotAuth | CodexAuth, next: CopilotAuth | CodexAuth) {
  if (id === "codex" && changedCodexAuth(next as CodexAuth, prev as CodexAuth)) {
    await setAuth("codex", next as CodexAuth)
  }
}

async function runPrompt(id: ProviderID, options: Options, value: string) {
  const current = await auth(id)
  if (!current) {
    console.error(`Missing ${id} auth. Run: tart login ${id}`)
    return 1
  }

  const model = await resolveRuntimeModel(id, current, { env: process.env, copilotModels: (auth) => copilot.models(auth) }, options.model)
  const msg = promptMessages({ system: options.system, prompt: value })

  const run =
    id === "copilot"
      ? await copilot.prompt(current as CopilotAuth, { model, msg })
      : await codex.prompt(current as CodexAuth, { model, msg })

  await saveAuth(id, current, run.auth)
  const result = await stream(run.events)
  reportUsage("run", result.usage)
  return 0
}

async function prompt(provider: ProviderID, args: string[]) {
  const options = parse(args)
  const value = text(options.args) || (await stdin())
  if (!value) {
    console.error("Prompt text is required.")
    return 1
  }
  return runPrompt(provider, options, value)
}

async function chat(provider: ProviderID, args: string[]) {
  const options = parse(args)
  const current = await auth(provider)
  if (!current) {
    console.error(`Missing ${provider} auth. Run: tart login ${provider}`)
    return 1
  }

  const model = await resolveRuntimeModel(
    provider,
    current,
    { env: process.env, copilotModels: (auth) => copilot.models(auth) },
    options.model,
  )
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const store = createSessionStore()
  const saved = options.session ? await store.create(options.session) : await store.create()
  let nextAuth = current
  let session = createSession({ id: saved.id, transcript: saved.transcript })

  console.error(`session: ${saved.id}`)

  async function turn(value: string) {
    session = appendUserText(session, value)
    await store.appendMessage(saved.id, { role: "user", content: value })
    const run =
      provider === "copilot"
        ? await copilot.prompt(nextAuth as CopilotAuth, {
            model,
            msg: sessionMessages(session, { system: options.system }),
            sessionId: saved.id,
          })
        : await codex.prompt(nextAuth as CodexAuth, {
            model,
            msg: sessionMessages(session, { system: options.system }),
            sessionId: saved.id,
          })
    await saveAuth(provider, nextAuth, run.auth)
    nextAuth = run.auth
    const result = await stream(run.events)
    reportUsage("turn", result.usage)
    session = appendAssistantText(session, result.text)
    await store.appendMessage(saved.id, { role: "assistant", content: result.text })
    await store.appendRun(saved.id, { provider, model, system: options.system })
  }

  try {
    const first = text(options.args)
    if (first) await turn(first)

    while (true) {
      const value = (await rl.question("> ")).trim()
      if (!value) continue
      if (value === "exit" || value === "quit" || value === "/exit") break
      await turn(value)
    }
  } finally {
    rl.close()
  }

  return 0
}

export async function main(argv = process.argv.slice(2)) {
  const [command, provider, ...rest] = argv

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP_GLOBAL)
    return 0
  }

  if (command === "--version" || command === "-V") {
    console.log(getVersion())
    return 0
  }

  if (command === "login") {
    if (provider === "--help" || provider === "-h") {
      console.log(HELP_LOGIN)
      return 0
    }
    if (provider === "copilot") return loginCopilot(rest)
    if (provider === "codex") return loginCodex()
    usage()
    return 1
  }

  if (command === "prompt") {
    if (provider === "--help" || provider === "-h") {
      console.log(HELP_PROMPT)
      return 0
    }
    if (provider !== "copilot" && provider !== "codex") {
      usage()
      return 1
    }
    return prompt(provider, rest)
  }

  if (command === "chat") {
    if (provider === "--help" || provider === "-h") {
      console.log(HELP_CHAT)
      return 0
    }
    if (provider !== "copilot" && provider !== "codex") {
      usage()
      return 1
    }
    return chat(provider, rest)
  }

  if (provider !== "copilot" && provider !== "codex") {
    usage()
    return 1
  }

  usage()
  return 1
}

if (import.meta.main) process.exit(await main())
