import { describe, expect, test } from "bun:test"
import { loginCopilot, normalizeEnterpriseUrl, type CopilotDeviceCode } from "./copilot"
import type { CopilotAuth } from "./contracts"

const device: CopilotDeviceCode = {
  verification_uri: "https://github.com/login/device",
  user_code: "ABCD-EFGH",
  device_code: "device-code",
  interval: 5,
}

describe("copilot login", () => {
  test("normalizes enterprise urls", async () => {
    const calls: string[] = []
    const writes: CopilotAuth[] = []

    const auth = await loginCopilot(
      {
        enterpriseUrl: " https://github.example.com/ ",
      },
      {
        async device(url) {
          calls.push(`device:${url}`)
          return device
        },
        async poll(code, url) {
          expect(code).toEqual(device)
          calls.push(`poll:${url}`)
          return {
            refresh: "r1",
            access: "a1",
            expires: 1,
            enterpriseUrl: "https://github.example.com/",
          }
        },
        async set(_id, auth) {
          writes.push(auth)
        },
      },
    )

    expect(normalizeEnterpriseUrl(" https://github.example.com/ ")).toBe("github.example.com")
    expect(calls).toEqual(["device:github.example.com", "poll:github.example.com"])
    expect(auth).toEqual({
      refresh: "r1",
      access: "a1",
      expires: 1,
      enterpriseUrl: "github.example.com",
    })
    expect(writes).toEqual([
      {
        refresh: "r1",
        access: "a1",
        expires: 1,
        enterpriseUrl: "github.example.com",
      },
    ])
  })

  test("persists successful copilot auth", async () => {
    const writes: CopilotAuth[] = []

    const auth = await loginCopilot(
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
            refresh: "r2",
            access: "a2",
            expires: 2,
          }
        },
        async set(_id, auth) {
          writes.push(auth)
        },
      },
    )

    expect(auth).toEqual({
      refresh: "r2",
      access: "a2",
      expires: 2,
      enterpriseUrl: undefined,
    })
    expect(writes).toEqual([
      {
        refresh: "r2",
        access: "a2",
        expires: 2,
        enterpriseUrl: undefined,
      },
    ])
  })

  test("does not write auth when polling does not complete", async () => {
    let wrote = false

    const auth = await loginCopilot(
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

    expect(auth).toBeUndefined()
    expect(wrote).toBe(false)
  })
})
