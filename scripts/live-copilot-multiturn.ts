import path from "node:path"
import { createSessionStore } from "../src/core/session-store"
import { appendAssistantText, appendUserText, createSession, sessionMessages } from "../src/core/session"
import { resolveRuntimeModel } from "../src/core/runtime"
import { copilot } from "../src/providers/copilot/provider"
import { assert, collect, logUsage, persistAuth, requireLiveOptIn, requireProviderAuth } from "./_live"

requireLiveOptIn("Copilot multi-turn live validation")

const token = `COPILOT_${Date.now().toString(36)}`
const sessionId = `live-copilot-${Date.now().toString(36)}`
const system = "Follow the user's exact output-format instructions."

const prompts = [
  {
    prompt: `Reply with exactly this token and nothing else: ${token}`,
    expected: token,
  },
  {
    prompt: "Using only the token from your immediately previous answer, reply with exactly: AGAIN <that same token>",
    expected: `AGAIN ${token}`,
  },
  {
    prompt: "One more time, using the same token already established in this conversation, reply with exactly: FINAL <that same token>",
    expected: `FINAL ${token}`,
  },
]

let auth = await requireProviderAuth("copilot")
const model =
  process.env.RUNTIME_COPILOT_MODEL ??
  (await resolveRuntimeModel("copilot", auth, { env: process.env, copilotModels: (current) => copilot.models(current) }))

const store = createSessionStore({ root: path.join(process.cwd(), ".tmp", "live-validation-sessions") })
await store.create(sessionId)

let session = createSession({ id: sessionId })

for (const [index, turn] of prompts.entries()) {
  session = appendUserText(session, turn.prompt)
  await store.appendMessage(sessionId, { role: "user", content: turn.prompt })

  const run = await copilot.prompt(auth, {
    model,
    msg: sessionMessages(session, { system }),
    sessionId,
  })

  await persistAuth("copilot", auth, run.auth)
  auth = run.auth

  const result = await collect(run.events)
  assert(result.text === turn.expected, `Turn ${index + 1} mismatch. Expected "${turn.expected}" but got "${result.text}".`)

  session = appendAssistantText(session, result.text)
  await store.appendMessage(sessionId, { role: "assistant", content: result.text })
  await store.appendRun(sessionId, { provider: "copilot", model, system })
  logUsage(`copilot turn ${index + 1}`, result.usage)
}

const stored = await store.get(sessionId)
assert(stored?.transcript.length === 6, `Expected 6 persisted transcript entries, got ${stored?.transcript.length ?? 0}.`)

console.log(`Copilot multi-turn live validation passed (${model}, session ${sessionId}).`)
