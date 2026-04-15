import { loop } from "../src/core/loop"
import { codex } from "../src/providers/codex/provider"
import { assert, logUsage, persistAuth, requireLiveOptIn, requireProviderAuth } from "./_live"

requireLiveOptIn("Codex loop live validation")

const token = `CODEX_${Date.now().toString(36)}`
const model = process.env.RUNTIME_CODEX_MODEL ?? process.env.RUNTIME_MODEL ?? "gpt-5.4-mini"

let toolCalls = 0
let seenToken: string | undefined
const auth = await requireProviderAuth("codex")

const result = await loop({
  adapter: codex,
  auth,
  model,
  maxSteps: 4,
  msg: [
    {
      role: "system",
      content: 'When the user says you must call a tool, call that tool exactly once before answering.',
    },
    {
      role: "user",
      content:
        `Call the tool echo_validation_token exactly once with JSON {"token":"${token}"}. ` +
        `After the tool returns, answer with exactly: VALIDATED ${token}`,
    },
  ],
  tools: [
    {
      name: "echo_validation_token",
      description: "Echoes the validation token back to the model.",
      schema: {
        type: "object",
        properties: {
          token: { type: "string" },
        },
        required: ["token"],
        additionalProperties: false,
      },
      call(input) {
        assert(input && typeof input === "object", "Codex tool input was not an object.")
        const value = "token" in input && typeof input.token === "string" ? input.token : undefined
        assert(value === token, `Codex tool token mismatch. Expected "${token}" but got "${value ?? "undefined"}".`)
        toolCalls += 1
        seenToken = value
        return JSON.stringify({ token: value, ok: true })
      },
    },
  ],
})

await persistAuth("codex", auth, result.auth)

assert(result.stop === "done", `Expected loop stop=done but got ${result.stop}.`)
assert(result.steps === 2, `Expected exactly 2 loop steps but got ${result.steps}.`)
assert(toolCalls === 1, `Expected exactly 1 successful tool call but got ${toolCalls}.`)
assert(seenToken === token, `Expected echoed token ${token} but saw ${seenToken ?? "undefined"}.`)
assert(result.text === `VALIDATED ${token}`, `Unexpected final Codex text: "${result.text}".`)
assert(
  result.msg.some((msg) => msg.role === "assistant" && "calls" in msg && msg.calls.some((call) => call.name === "echo_validation_token")),
  "Expected assistant tool call in final loop transcript.",
)
assert(
  result.msg.some((msg) => msg.role === "tool" && msg.name === "echo_validation_token" && msg.content.includes(token)),
  "Expected tool output message in final loop transcript.",
)

logUsage("codex loop", result.usage)
console.log(`Codex loop live validation passed (${model}).`)
