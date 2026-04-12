import type { Call, LoopInput, LoopResult, Msg, Part } from "./contracts"

function abort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError"
}

function same(a: Call[], b: Call[]) {
  return (
    JSON.stringify(a.map((item) => [item.name, item.input])) ===
    JSON.stringify(b.map((item) => [item.name, item.input]))
  )
}

function parse(text: string) {
  if (!text) return {}
  return JSON.parse(text) as unknown
}

async function emit(part: Part, onPart?: LoopInput<unknown>["onPart"]) {
  if (!onPart) return
  await onPart(part)
}

function prev(msg: Msg[]) {
  return [...msg].reverse().find((item) => item.role === "assistant" && "calls" in item)
}

export async function loop<Auth>(input: LoopInput<Auth>): Promise<LoopResult<Auth>> {
  const max = input.maxSteps ?? 8
  const msg = [...input.msg]
  const tools = input.tools ?? []
  let auth = input.auth
  let text = ""
  let step = 0

  while (step < max) {
    try {
      input.abort?.throwIfAborted()
      const run = await input.adapter.prompt(auth, {
        model: input.model,
        msg,
        max: input.max,
        tools: tools.map((item) => ({
          name: item.name,
          description: item.description,
          schema: item.schema,
        })),
        abort: input.abort,
      })
      auth = run.auth
      step += 1
      let out = ""
      let calls: Call[] = []

      for await (const part of run.events) {
        await emit(part, input.onPart)
        if (part.type === "error") throw new Error(part.text)
        if (part.type === "text") out += part.text
        if (part.type === "tool") calls = [...calls, part.call]
      }

      if (out) {
        msg.push({ role: "assistant", content: out })
        text = out
      }

      if (!calls.length) {
        return { auth, msg, steps: step, stop: "done", text }
      }

      const last = prev(msg)
      msg.push({ role: "assistant", calls })

      if (step >= max) {
        return { auth, msg, steps: step, stop: "limit", text }
      }

      if (last && same(last.calls, calls)) {
        return { auth, msg, steps: step, stop: "repeat", text }
      }

      for (const call of calls) {
        input.abort?.throwIfAborted()
        const tool = tools.find((item) => item.name === call.name)
        if (!tool) {
          msg.push({ role: "tool", id: call.id, name: call.name, content: `Tool not found: ${call.name}`, error: true })
          continue
        }
        const content = await tool.call(parse(call.input), { abort: input.abort, call, step })
        msg.push({ role: "tool", id: call.id, name: call.name, content })
      }
    } catch (err) {
      if (!abort(err)) throw err
      return { auth, msg, steps: step, stop: "abort", text }
    }
  }

  return { auth, msg, steps: step, stop: "limit", text }
}
