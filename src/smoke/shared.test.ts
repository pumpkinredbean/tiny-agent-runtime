import { describe, expect, test } from "bun:test"
import { miss, pick } from "./shared"

describe("smoke pick", () => {
  test("uses explicit provider arg", () => {
    expect(pick(["copilot", "say", "pong"], {}, undefined)).toEqual({
      provider: "copilot",
      prompt: "say pong",
    })
  })

  test("falls back to env provider", () => {
    expect(pick(["say", "pong"], { RUNTIME_PROVIDER: "codex" }, undefined)).toEqual({
      provider: "codex",
      prompt: "say pong",
    })
  })

  test("keeps forced provider wrappers thin", () => {
    expect(pick(["say", "pong"], {}, "copilot")).toEqual({
      provider: "copilot",
      prompt: "say pong",
    })
  })

  test("returns a clear bridge path for missing auth", () => {
    expect(miss("codex", { RUNTIME_AUTH_PATH: "/tmp/runtime-auth.json", OPENCODE_AUTH_PATH: "/tmp/auth.json" })).toBe(
      "missing codex oauth in /tmp/runtime-auth.json (optional legacy import from /tmp/auth.json)",
    )
  })

  test("throws usage when no provider is available", () => {
    expect(() => pick([], {}, undefined)).toThrow("usage: bun run src/smoke/index.ts [copilot|codex] [prompt]")
  })
})
