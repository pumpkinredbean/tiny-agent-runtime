import { file as authFile, get, set } from "../auth/store"
import type { CodexAuth, CopilotAuth } from "../auth/contracts"
import type { ProviderID } from "../core/contracts"
import { codex } from "../provider/codex"
import { copilot } from "../provider/copilot"

type Env = Record<string, string | undefined>

type Pick = {
  provider: ProviderID
  prompt: string
}

type Opts = {
  argv?: string[]
  env?: Env
  provider?: ProviderID
}

function provider(arg?: string) {
  if (arg === "copilot" || arg === "codex") return arg
}

function usage() {
  return "usage: bun run src/smoke/index.ts [copilot|codex] [prompt]"
}

export function pick(argv: string[], env: Env, force?: ProviderID): Pick {
  const head = provider(argv[0])
  const id = force ?? head ?? provider(env.RUNTIME_PROVIDER)
  if (!id) throw new Error(usage())
  return {
    provider: id,
    prompt: (force ? argv : head ? argv.slice(1) : argv).join(" ") || "Reply with the single word pong.",
  }
}

export function miss(id: ProviderID, env: Env) {
  return `missing ${id} oauth in ${env.RUNTIME_AUTH_PATH ?? authFile()}`
}

async function loadAuth(id: "copilot"): Promise<CopilotAuth | undefined>
async function loadAuth(id: "codex"): Promise<CodexAuth | undefined>
async function loadAuth(id: ProviderID) {
  return id === "copilot" ? get("copilot") : get("codex")
}

function changed(
  a: { refresh: string; access: string; expires: number; accountId?: string },
  b: { refresh: string; access: string; expires: number; accountId?: string },
) {
  return a.refresh !== b.refresh || a.access !== b.access || a.expires !== b.expires || a.accountId !== b.accountId
}

async function model(id: "copilot", env: Env, auth: CopilotAuth): Promise<string | undefined>
async function model(id: "codex", env: Env): Promise<string>
async function model(id: ProviderID, env: Env, auth?: CopilotAuth) {
  if (env.RUNTIME_MODEL) return env.RUNTIME_MODEL
  if (id === "codex") return "gpt-5.4-mini"
  if (!auth) return
  const ids = await copilot.models(auth)
  return ids[0]
}

export async function run(opts: Opts = {}) {
  const env = opts.env ?? process.env
  const arg = pick(opts.argv ?? process.argv.slice(2), env, opts.provider)

  if (arg.provider === "copilot") {
    const auth = await loadAuth("copilot")
    if (!auth) throw new Error(miss("copilot", env))
    const name = await model("copilot", env, auth)
    if (!name) throw new Error("no copilot model available")
    console.log(`provider=copilot model=${name}`)
    const out = await copilot.prompt(auth, {
      model: name,
      msg: [{ role: "user", content: arg.prompt }],
    })
    for await (const item of out.events) {
      if (item.type === "text" || item.type === "reasoning") process.stdout.write(item.text)
      if (item.type === "error") process.stderr.write(`\n[error] ${item.text}\n`)
    }
    process.stdout.write("\n")
    return
  }

  const auth = await loadAuth("codex")
  if (!auth) throw new Error(miss("codex", env))
  const name = await model("codex", env)
  if (!name) throw new Error("no codex model available")
  console.log(`provider=codex model=${name}`)
  const out = await codex.prompt(auth, {
    model: name,
    msg: [{ role: "user", content: arg.prompt }],
  })
  if (changed(out.auth, auth)) {
    await set("codex", out.auth)
    process.stderr.write(`persisted refreshed codex auth to ${authFile()}\n`)
  }
  for await (const item of out.events) {
    if (item.type === "text" || item.type === "reasoning") process.stdout.write(item.text)
    if (item.type === "error") process.stderr.write(`\n[error] ${item.text}\n`)
  }
  process.stdout.write("\n")
}

export async function main(opts?: Opts) {
  try {
    await run(opts)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}
