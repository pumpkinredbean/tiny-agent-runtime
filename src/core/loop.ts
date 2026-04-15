import { createToolRegistry } from "../tools/registry"
import type { Call, LoopInput, LoopResult, Msg, Part } from "./contracts"
import { mergeUsage } from "./usage"

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

function toolError(name: string, detail: string) {
  return `Tool ${name} failed: ${detail}`
}

function timeoutError(name: string, ms: number) {
  return toolError(name, `timed out after ${ms}ms`)
}

class ToolTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Tool timed out after ${ms}ms`)
    this.name = "ToolTimeoutError"
  }
}

function normalize(value: unknown) {
  if (typeof value === "string") return value
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value) || typeof value === "object") {
    try {
      const out = JSON.stringify(value)
      return out === undefined ? null : out
    } catch {
      return null
    }
  }
  return null
}

async function emit(part: Part, onPart?: LoopInput<unknown>["onPart"]) {
  if (!onPart) return
  await onPart(part)
}

function waitForAbort(signal: AbortSignal) {
  let onAbort: (() => void) | undefined
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"))
      return
    }
    const listener = () => {
      signal.removeEventListener("abort", listener)
      reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"))
    }
    onAbort = listener
    signal.addEventListener("abort", onAbort, { once: true })
  })
  return {
    promise,
    cleanup() {
      const listener = onAbort
      if (listener) signal.removeEventListener("abort", listener)
    },
  }
}

function waitForTimeout(ms: number) {
  let id: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new ToolTimeoutError(ms)), ms)
  })
  return {
    promise,
    cleanup() {
      if (id !== undefined) clearTimeout(id)
    },
  }
}

async function runToolCall(
  call: Promise<unknown> | unknown,
  options: { abort?: AbortSignal; toolTimeoutMs?: number },
) {
  const pending: Array<{ promise: Promise<never>; cleanup: () => void }> = []
  if (options.abort) pending.push(waitForAbort(options.abort))
  if (options.toolTimeoutMs !== undefined) pending.push(waitForTimeout(options.toolTimeoutMs))
  if (!pending.length) return await call
  try {
    return await Promise.race([Promise.resolve(call), ...pending.map((item) => item.promise)])
  } finally {
    for (const item of pending) item.cleanup()
  }
}

function prev(msg: Msg[]) {
  return [...msg].reverse().find((item) => item.role === "assistant" && "calls" in item)
}

export async function loop<Auth>(input: LoopInput<Auth>): Promise<LoopResult<Auth>> {
  const max = input.maxSteps ?? 8
  const toolTimeoutMs = input.toolTimeoutMs
  const msg = [...input.msg]
  const registry = createToolRegistry({ tools: input.tools, plugins: input.toolPlugins })
  const tools = registry.list()
  let auth = input.auth
  let text = ""
  let step = 0
  let usage = {}

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
      let stepUsage = {}

      for await (const part of run.events) {
        await emit(part, input.onPart)
        if (part.type === "error") throw new Error(part.text)
        if (part.type === "text") out += part.text
        if (part.type === "tool") calls = [...calls, part.call]
        if (part.type === "usage") stepUsage = mergeUsage(stepUsage, part.usage)
      }

      usage = mergeUsage(usage, stepUsage)

      if (out) {
        msg.push({ role: "assistant", content: out })
        text = out
      }

      if (!calls.length) {
        return { auth, msg, steps: step, stop: "done", text, usage }
      }

      const last = prev(msg)
      msg.push({ role: "assistant", calls })

      if (step >= max) {
        return { auth, msg, steps: step, stop: "limit", text, usage }
      }

      if (last && same(last.calls, calls)) {
        return { auth, msg, steps: step, stop: "repeat", text, usage }
      }

      for (const call of calls) {
        input.abort?.throwIfAborted()
        const tool = registry.get(call.name)
        if (!tool) {
          msg.push({ role: "tool", id: call.id, name: call.name, content: `Tool not found: ${call.name}`, error: true })
          continue
        }
        let parsed: unknown
        try {
          parsed = parse(call.input)
        } catch {
          msg.push({ role: "tool", id: call.id, name: call.name, content: toolError(call.name, "invalid JSON input"), error: true })
          continue
        }

        try {
          const content = normalize(
            await runToolCall(tool.call(parsed, { abort: input.abort, call, step }), {
              abort: input.abort,
              toolTimeoutMs,
            }),
          )
          if (content === null) {
            msg.push({
              role: "tool",
              id: call.id,
              name: call.name,
              content: toolError(call.name, "invalid return value"),
              error: true,
            })
            continue
          }
          msg.push({ role: "tool", id: call.id, name: call.name, content })
        } catch (err) {
          if (abort(err)) throw err
          if (err instanceof ToolTimeoutError) {
            msg.push({ role: "tool", id: call.id, name: call.name, content: timeoutError(call.name, err.ms), error: true })
            continue
          }
          const detail = err instanceof Error ? err.message : "unknown error"
          msg.push({ role: "tool", id: call.id, name: call.name, content: toolError(call.name, detail), error: true })
        }
      }
    } catch (err) {
      if (!abort(err)) throw err
      return { auth, msg, steps: step, stop: "abort", text, usage }
    }
  }

  return { auth, msg, steps: step, stop: "limit", text, usage }
}
