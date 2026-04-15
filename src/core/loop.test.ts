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
    expect(result.usage).toEqual({})
    expect(result.msg).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])
  })

  test("aggregates usage across loop steps", async () => {
    const result = await loop({
      adapter: {
        id: "copilot",
        async prompt(auth, req) {
          return {
            auth,
            model: req.model,
            url: "test://runtime",
            events: events(
              req.msg.some((item) => item.role === "tool")
                ? [
                    { type: "usage", usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18, cost: { usd: 0.22 } } },
                    { type: "text", text: "done" },
                    { type: "done", reason: "stop" },
                  ]
                : [
                    { type: "usage", usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, cachedInputTokens: 2 } },
                    { type: "tool", call: call("c1", "ping", "{}") },
                    { type: "done", reason: "tool_calls" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "ping",
          async call() {
            return "ok"
          },
        },
      ],
    })

    expect(result.stop).toBe("done")
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 16,
      totalTokens: 26,
      cachedInputTokens: 2,
      cost: { usd: 0.22 },
    })
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

  test("keeps missing tools non-fatal and emits a tool error message", async () => {
    const seen: Prompt[] = []
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
                    { type: "tool", call: call("c1", "missing", "{}") },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "continued" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "go" }],
    })

    expect(result.stop).toBe("done")
    expect(seen[1]?.msg).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", calls: [call("c1", "missing", "{}")] },
      { role: "tool", id: "c1", name: "missing", content: "Tool not found: missing", error: true },
    ])
  })

  test("turns malformed tool input into a tool error message", async () => {
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
                    { type: "tool", call: call("c1", "weather", "{") },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "continued" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "weather",
          async call() {
            ran += 1
            return "never"
          },
        },
      ],
    })

    expect(ran).toBe(0)
    expect(result.stop).toBe("done")
    expect(seen[1]?.msg).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", calls: [call("c1", "weather", "{")] },
      { role: "tool", id: "c1", name: "weather", content: "Tool weather failed: invalid JSON input", error: true },
    ])
  })

  test("turns ordinary tool throws into tool error messages", async () => {
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
                    { type: "tool", call: call("c1", "explode", "{}") },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "continued" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "explode",
          async call() {
            ran += 1
            throw new Error("boom")
          },
        },
      ],
    })

    expect(ran).toBe(1)
    expect(result.stop).toBe("done")
    expect(seen[1]?.msg).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", calls: [call("c1", "explode", "{}")] },
      { role: "tool", id: "c1", name: "explode", content: "Tool explode failed: boom", error: true },
    ])
  })

  test("serializes valid non-string tool returns and flags invalid ones", async () => {
    const seen: Prompt[] = []
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
                    { type: "tool", call: call("c1", "json", "{}") },
                    { type: "tool", call: call("c2", "void", "{}") },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "continued" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "go" }],
      tools: [
        {
          name: "json",
          async call() {
            return { ok: true }
          },
        },
        {
          name: "void",
          async call() {
            return undefined
          },
        },
      ],
    })

    expect(result.stop).toBe("done")
    expect(seen[1]?.msg).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", calls: [call("c1", "json", "{}"), call("c2", "void", "{}")] },
      { role: "tool", id: "c1", name: "json", content: '{"ok":true}' },
      { role: "tool", id: "c2", name: "void", content: "Tool void failed: invalid return value", error: true },
    ])
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

  test("turns timed out tool calls into tool error messages and continues", async () => {
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
                    { type: "tool", call: call("c1", "slow", "{}") },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "continued" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "go" }],
      toolTimeoutMs: 0,
      tools: [
        {
          name: "slow",
          async call() {
            ran += 1
            return await new Promise(() => {})
          },
        },
      ],
    })

    expect(ran).toBe(1)
    expect(result.stop).toBe("done")
    expect(seen[1]?.msg).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", calls: [call("c1", "slow", "{}")] },
      { role: "tool", id: "c1", name: "slow", content: "Tool slow failed: timed out after 0ms", error: true },
    ])
  })

  test("returns abort when parent abort fires during a non-cooperative timed tool call", async () => {
    const ctrl = new AbortController()
    const resultPromise = loop({
      adapter: fake(() => [
        { type: "tool", call: call("c1", "wait", "{}") },
        { type: "done", reason: "tool_calls" },
      ]),
      auth: { id: "a" },
      model: "x",
      abort: ctrl.signal,
      msg: [{ role: "user", content: "wait" }],
      toolTimeoutMs: 50,
      tools: [
        {
          name: "wait",
          async call() {
            ctrl.abort()
            return await new Promise(() => {})
          },
        },
      ],
    })

    const result = await resultPromise

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

  test("guards repeated failing tool calls", async () => {
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
            throw new Error("boom")
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

  test("supports plugin-provided tools without changing direct tool callers", async () => {
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
                    { type: "tool", call: call("c1", "clock", '{"zone":"UTC"}') },
                    { type: "done", reason: "tool_calls" },
                  ]
                : [
                    { type: "text", text: "12:00" },
                    { type: "done", reason: "stop" },
                  ],
            ),
          }
        },
      },
      auth: { id: "a" },
      model: "x",
      msg: [{ role: "user", content: "time?" }],
      toolPlugins: [
        {
          name: "clock-plugin",
          tools: [
            {
              name: "clock",
              description: "Returns a sample time",
              async call(input) {
                ran += 1
                expect(input).toEqual({ zone: "UTC" })
                return "12:00"
              },
            },
          ],
        },
      ],
    })

    expect(ran).toBe(1)
    expect(seen[0]?.tools).toEqual([{ name: "clock", description: "Returns a sample time", schema: undefined }])
    expect(result.stop).toBe("done")
    expect(result.msg.at(-1)).toEqual({ role: "assistant", content: "12:00" })
  })
})
