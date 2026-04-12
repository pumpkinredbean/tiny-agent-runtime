import { describe, expect, test } from "bun:test"
import { parse } from "./opencode"

describe("opencode auth bridge", () => {
  test("parses oauth entries and skips non-oauth data", () => {
    const auth = parse(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "r1",
          access: "a1",
          expires: 1,
          enterpriseUrl: "github.example.com",
        },
        openai: {
          type: "oauth",
          refresh: "r2",
          access: "a2",
          expires: 2,
          accountId: "acct_1",
        },
        bad: {
          type: "token",
          value: "x",
        },
      }),
    )

    expect(auth).toEqual({
      "github-copilot": {
        refresh: "r1",
        access: "a1",
        expires: 1,
        enterpriseUrl: "github.example.com",
        accountId: undefined,
      },
      openai: {
        refresh: "r2",
        access: "a2",
        expires: 2,
        accountId: "acct_1",
        enterpriseUrl: undefined,
      },
    })
  })
})
