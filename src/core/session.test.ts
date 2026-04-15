import { describe, expect, test } from "bun:test"
import { appendAssistantText, appendUserText, createSession, promptMessages, sessionMessages } from "./session"

describe("session helpers", () => {
  test("assembles system history and prompt into canonical messages", () => {
    expect(
      promptMessages({
        system: "Be concise",
        history: [{ role: "assistant", content: "Earlier" }],
        prompt: "Hello",
      }),
    ).toEqual([
      { role: "system", content: "Be concise" },
      { role: "assistant", content: "Earlier" },
      { role: "user", content: "Hello" },
    ])
  })

  test("maintains reusable in-memory chat session state", () => {
    const session = appendAssistantText(appendUserText(createSession(), "Hi"), "Hello")

    expect(sessionMessages(session, { system: "Be helpful" })).toEqual([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ])
  })

  test("uses only transcript plus the current run config", () => {
    const session = createSession({
      transcript: [{ role: "assistant", content: "Earlier answer" }],
    })

    expect(sessionMessages(session, { system: "Current system" })).toEqual([
      { role: "system", content: "Current system" },
      { role: "assistant", content: "Earlier answer" },
    ])
  })
})
