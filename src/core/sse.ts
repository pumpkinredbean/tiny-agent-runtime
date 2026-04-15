import type { Call, Part } from "./contracts"
import { normalizeUsage } from "./usage"

type SSE = {
  event?: string
  data: string
}

async function* raw(body: ReadableStream<Uint8Array>) {
  const rd = body.getReader()
  const dec = new TextDecoder()
  let buf = ""

  while (true) {
    const part = await rd.read()
    if (part.done) break
    buf += dec.decode(part.value, { stream: true })

    while (true) {
      const i = buf.indexOf("\n\n")
      if (i === -1) break
      const item = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const rows = item.split(/\r?\n/)
      const evt = rows
        .find((row) => row.startsWith("event:"))
        ?.slice(6)
        .trim()
      const data = rows
        .filter((row) => row.startsWith("data:"))
        .map((row) => row.slice(5).trimStart())
        .join("\n")
      if (data) yield { event: evt, data } satisfies SSE
    }
  }

  const tail = buf.trim()
  if (!tail) return
  const rows = tail.split(/\r?\n/)
  const evt = rows
    .find((row) => row.startsWith("event:"))
    ?.slice(6)
    .trim()
  const data = rows
    .filter((row) => row.startsWith("data:"))
    .map((row) => row.slice(5).trimStart())
    .join("\n")
  if (data) yield { event: evt, data } satisfies SSE
}

function json(text: string) {
  return JSON.parse(text) as Record<string, unknown>
}

function obj(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function flush(calls: Map<number | string, Call>, sent: Set<number | string>) {
  return [...calls.entries()]
    .filter(([id, call]) => !sent.has(id) && call.id && call.name)
    .map(([id, call]) => {
      sent.add(id)
      return { type: "tool", call } satisfies Part
    })
}

function* usagePart(value: unknown, sent: Set<string>) {
  const usage = normalizeUsage(value)
  if (!usage) return
  const key = JSON.stringify(usage)
  if (sent.has(key)) return
  sent.add(key)
  yield { type: "usage", usage } satisfies Part
}

export async function* chat(body: ReadableStream<Uint8Array>) {
  const calls = new Map<number, Call>()
  const sent = new Set<number>()
  const usage = new Set<string>()

  for await (const item of raw(body)) {
    if (item.data === "[DONE]") {
      yield* flush(calls, sent)
      yield { type: "done" } satisfies Part
      continue
    }

    const data = json(item.data)
    yield* usagePart((data as Record<string, unknown>).usage, usage)
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined
    const delta = choice && typeof choice === "object" ? choice.delta : undefined

    if (delta && typeof delta === "object" && typeof delta.content === "string" && delta.content) {
      yield { type: "text", text: delta.content } satisfies Part
    }

    if (delta && typeof delta === "object" && typeof delta.reasoning_text === "string" && delta.reasoning_text) {
      yield { type: "reasoning", text: delta.reasoning_text } satisfies Part
    }

    if (delta && typeof delta === "object" && Array.isArray(delta.tool_calls)) {
      for (const item of delta.tool_calls) {
        if (!item || typeof item !== "object") continue
        const n = typeof item.index === "number" ? item.index : calls.size
        const prev = calls.get(n) ?? { id: "", name: "", input: "" }
        const fn = item.function
        calls.set(n, {
          id: typeof item.id === "string" ? item.id : prev.id,
          name: fn && typeof fn === "object" && typeof fn.name === "string" ? fn.name : prev.name,
          input: prev.input + (fn && typeof fn === "object" && typeof fn.arguments === "string" ? fn.arguments : ""),
        })
      }
    }

    const reason =
      choice && typeof choice === "object" && typeof choice.finish_reason === "string"
        ? choice.finish_reason
        : undefined
    if (!reason) continue
    if (reason === "tool_calls" || reason === "function_call") yield* flush(calls, sent)
    yield { type: "done", reason } satisfies Part
  }
}

export async function* responses(body: ReadableStream<Uint8Array>) {
  const calls = new Map<string, Call>()
  const sent = new Set<string>()
  const usage = new Set<string>()

  for await (const item of raw(body)) {
    if (item.data === "[DONE]") {
      yield* flush(calls, sent)
      yield { type: "done" } satisfies Part
      continue
    }

    const data = json(item.data)
    yield* usagePart((data as Record<string, unknown>).usage, usage)
    const response = obj((data as Record<string, unknown>).response)
    yield* usagePart(response?.usage, usage)
    const type = typeof data.type === "string" ? data.type : item.event

    if (type === "response.output_text.delta" && typeof data.delta === "string" && data.delta) {
      yield { type: "text", text: data.delta } satisfies Part
      continue
    }

    if (typeof type === "string" && /reasoning.*delta/.test(type) && typeof data.delta === "string" && data.delta) {
      yield { type: "reasoning", text: data.delta } satisfies Part
      continue
    }

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const out = obj(data.item)
      if (out?.type === "function_call" && typeof out.id === "string") {
        const prev = calls.get(out.id) ?? {
          id: typeof out.call_id === "string" ? out.call_id : out.id,
          name: "",
          input: "",
        }
        calls.set(out.id, {
          id: typeof out.call_id === "string" ? out.call_id : prev.id,
          name: typeof out.name === "string" ? out.name : prev.name,
          input: typeof out.arguments === "string" ? out.arguments : prev.input,
        })
        if (type === "response.output_item.done") yield* flush(calls, sent)
      }
      continue
    }

    if (type === "response.function_call_arguments.delta" && typeof data.item_id === "string") {
      const prev = calls.get(data.item_id) ?? {
        id: typeof data.call_id === "string" ? data.call_id : data.item_id,
        name: "",
        input: "",
      }
      calls.set(data.item_id, {
        ...prev,
        input: prev.input + (typeof data.delta === "string" ? data.delta : ""),
      })
      continue
    }

    if (type === "response.function_call_arguments.done" && typeof data.item_id === "string") {
      const prev = calls.get(data.item_id) ?? {
        id: typeof data.call_id === "string" ? data.call_id : data.item_id,
        name: "",
        input: "",
      }
      calls.set(data.item_id, {
        ...prev,
        input: typeof data.arguments === "string" ? data.arguments : prev.input,
      })
      continue
    }

    if (type === "response.failed") {
      yield {
        type: "error",
        text: typeof data.message === "string" ? data.message : "response failed",
        raw: data,
      } satisfies Part
      continue
    }

    if (type === "response.completed") {
      yield* flush(calls, sent)
      yield {
        type: "done",
        reason: typeof data.status === "string" ? data.status : undefined,
      } satisfies Part
    }
  }
}
