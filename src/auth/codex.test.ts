import { describe, expect, test } from "bun:test"
import { auth, loginCodex, type CodexDeviceCode } from "../providers/codex/auth"
import type { CodexAuth } from "./contracts"

const device: CodexDeviceCode = {
  verification_uri: "https://auth.openai.com/codex/device",
  user_code: "ABCD-EFGH",
  device_code: "device-auth-id",
  interval: 5,
  expires_in: 300,
}

function token(claims: Record<string, unknown>) {
  return `a.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.b`
}

describe("codex login", () => {
  test("persists successful codex auth", async () => {
    const writes: CodexAuth[] = []

    const next = await loginCodex(
      {
        onVerification(code) {
          expect(code).toEqual(device)
        },
      },
      {
        async device() {
          return device
        },
        async poll() {
          return {
            refresh_token: "r1",
            access_token: "a1",
            expires_in: 2,
            id_token: token({
              chatgpt_account_id: "acct_1",
            }),
          }
        },
        async set(_id, auth) {
          writes.push(auth)
        },
      },
    )

    expect(next?.refresh).toBe("r1")
    expect(next?.access).toBe("a1")
    expect(next?.accountId).toBe("acct_1")
    expect(typeof next?.expires).toBe("number")
    expect(writes).toHaveLength(1)
    expect(writes[0]?.refresh).toBe("r1")
    expect(writes[0]?.access).toBe("a1")
    expect(writes[0]?.accountId).toBe("acct_1")
  })

  test("does not write auth when polling does not complete", async () => {
    let wrote = false

    const next = await loginCodex(
      {},
      {
        async device() {
          return device
        },
        async poll() {
          return undefined
        },
        async set() {
          wrote = true
        },
      },
    )

    expect(next).toBeUndefined()
    expect(wrote).toBe(false)
  })

  test("extracts account ids from codex tokens", () => {
    expect(
      auth({
        refresh_token: "r1",
        access_token: token({
          organizations: [{ id: "org_1" }],
        }),
        id_token: token({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct_1",
          },
        }),
      }).accountId,
    ).toBe("acct_1")

    expect(
      auth({
        refresh_token: "r2",
        access_token: token({
          chatgpt_account_id: "acct_2",
        }),
      }).accountId,
    ).toBe("acct_2")

    expect(
      auth({
        refresh_token: "r3",
        access_token: token({
          organizations: [{ id: "org_3" }],
        }),
      }).accountId,
    ).toBe("org_3")
  })
})
