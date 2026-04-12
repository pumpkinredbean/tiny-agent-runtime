import { describe, expect, test } from "bun:test"
import { loop } from "./loop"
import type { Adapter, Call, Part, Prompt } from "./contracts"

function events(parts: Part[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) yield part
    },
  }
}

function call(id: string, name: string, input: string): Call {
  return { id, name, input }
}

function fake(fn: (req: Prompt, n: number) => Part[]): Adapter<{ id: string }> {
  let n = 0
  return {
    id: "copilot",
    async prompt(auth, req) {
      n += 1
      return {
        auth,
        model: req.model,
        url: "test://runtime",
        events: events(fn(req, n)),
      }
    },
  }
}

describe("loop", () => {
  test("finishes without tools", async () => {
    const result = await loop({
      adapter: fake(() => [
        { type: "text", text: "hello" },
        { type: "done", reason: "stop" },
      ]),
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "hi" }],
    })

    expect(result.stop).toBe("done")
    expect(result.steps).toBe(1)
    expect(result.text).toBe("hello")
    expect(result.msg).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  })

  test("reinjects tool results into next step", async () => {
    const seen: Prompt[] = []
    let ran = 0
    const result = await loop({
      adapter: {
        id: "copilot",
        async prompt(auth, req) {
          seen.push({ ...req, msg: structuredClone(req.msg), tools: structuredClone(req.tools) })
          return {
            auth,
            model: req.model,
            url: "test://runtime",
            events: events(
              seen.length === 1
                ? [
                    { type: "tool", call: call("c1", "weather", '{"city":"seoul"}') },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "sunny" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "weather?" }],
      tools: [
        {
          name: "weather",
          schema: { type: "object" },
          async call(input) {
            ran += 1
            expect(input).toEqual({ city: "seoul" })
            return "clear"
          },
        },
      ],
    })

    expect(ran).toBe(1)
    expect(result.stop).toBe("done")
    expect(result.steps).toBe(2)
    expect(seen[1]?.msg).toEqual([
      { role: "user", content: "weather?" },
      { role: "assistant", calls: [call("c1", "weather", '{"city":"seoul"}')] },
      { role: "tool", id: "c1", name: "weather", content: "clear" },
    ])
    expect(result.msg.at(-1)).toEqual({ role: "assistant", content: "sunny" })
  })

  test("returns abort when aborted during tool run", async () => {
    const ctrl = new AbortController()
    const result = await loop({
      adapter: fake(() => [
        { type: "tool", call: call("c1", "wait", "{}") },
        { type: "done", reason: "tool_calls" },
      ]),
      auth: { id: "a" },
      model: "x",
      abort: ctrl.signal,
      msg: [{ role: "user", content: "wait" }],
      tools: [
        {
          name: "wait",
          async call(_, ctx) {
            ctrl.abort()
            ctx.abort?.throwIfAborted()
            return "never"
          },
        },
      ],
    })

    expect(result.stop).toBe("abort")
    expect(result.steps).toBe(1)
    expect(result.msg).toEqual([
      { role: "user", content: "wait" },
      { role: "assistant", calls: [call("c1", "wait", "{}")] },
    ])
  })

  test("guards repeated tool calls", async () => {
    let ran = 0
    const result = await loop({
      adapter: fake((_, n) => {
        if (n === 1)
          return [
            { type: "tool", call: call("c1", "ping", "{}") },
            { type: "done", reason: "tool_calls" },
          ]
        return [
          { type: "tool", call: call("c2", "ping", "{}") },
          { type: "done", reason: "tool_calls" },
        ]
      }),
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "ping" }],
      tools: [
        {
          name: "ping",
          async call() {
            ran += 1
            return "ok"
          },
        },
      ],
    })

    expect(ran).toBe(1)
    expect(result.stop).toBe("repeat")
    expect(result.steps).toBe(2)
  })

  test("stops on step limit before rerun", async () => {
    let ran = 0
    const result = await loop({
      adapter: fake(() => [
        { type: "tool", call: call("c1", "ping", "{}") },
        { type: "done", reason: "tool_calls" },
      ]),
      auth: { id: "a" },
      model: "x",
      maxSteps: 1,
      msg: [{ role: "user", content: "ping" }],
      tools: [
        {
          name: "ping",
          async call() {
            ran += 1
            return "ok"
          },
        },
      ],
    })

    expect(ran).toBe(0)
    expect(result.stop).toBe("limit")
    expect(result.steps).toBe(1)
  })
})
