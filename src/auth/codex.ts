import { file, set } from "./store"
import type { CodexAuth } from "./contracts"
import { type CodexTokens, extractAccountId } from "../provider/codex"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const DEVICE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
const POLL_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
const TOKEN_URL = "https://auth.openai.com/oauth/token"
const VERIFY_URL = "https://auth.openai.com/codex/device"
const REDIRECT_URL = "https://auth.openai.com/deviceauth/callback"
const WAIT = 3000

type DeviceRes = {
  device_auth_id: string
  user_code: string
  interval: string | number
}

type PollRes = {
  authorization_code: string
  code_verifier: string
}

export type CodexDeviceCode = {
  verification_uri: string
  user_code: string
  device_code: string
  interval: number
  expires_in: number
}

type LoginDeps = {
  device(): Promise<CodexDeviceCode>
  poll(code: CodexDeviceCode): Promise<CodexTokens | undefined>
  set(id: "codex", auth: CodexAuth): Promise<void>
}

export type CodexLoginOptions = {
  onVerification?(device: CodexDeviceCode): void
}

const deps: LoginDeps = {
  async device() {
    const res = await fetch(DEVICE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) throw new Error(`codex device auth failed: ${res.status}`)
    const data = (await res.json()) as DeviceRes
    return {
      verification_uri: VERIFY_URL,
      user_code: data.user_code,
      device_code: data.device_auth_id,
      interval: Math.max(1, Number(data.interval) || 5),
      expires_in: 300,
    }
  },
  async poll(code) {
    const end = Date.now() + code.expires_in * 1000

    while (Date.now() < end) {
      await Bun.sleep(code.interval * 1000 + WAIT)

      const res = await fetch(POLL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_auth_id: code.device_code,
          user_code: code.user_code,
        }),
      })

      if (res.ok) {
        const data = (await res.json()) as PollRes
        const next = await fetch(TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: data.authorization_code,
            redirect_uri: REDIRECT_URL,
            client_id: CLIENT_ID,
            code_verifier: data.code_verifier,
          }).toString(),
        })
        if (!next.ok) throw new Error(`codex token exchange failed: ${next.status}`)
        return (await next.json()) as CodexTokens
      }

      if (res.status === 403 || res.status === 404) continue
      throw new Error(`codex device poll failed: ${res.status}`)
    }
  },
  set,
}

export function auth(data: CodexTokens): CodexAuth {
  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(data),
  }
}

export async function loginCodex(opts: CodexLoginOptions = {}, input: LoginDeps = deps) {
  const device = await input.device()
  opts.onVerification?.(device)

  const data = await input.poll(device)
  if (!data) return

  const next = auth(data)
  await input.set("codex", next)
  return next
}

export async function main() {
  try {
    const auth = await loginCodex({
      onVerification(device) {
        console.log(`Open ${device.verification_uri}`)
        console.log(`Enter code: ${device.user_code}`)
        console.log("Waiting for Codex authorization...")
      },
    })

    if (!auth) {
      console.error("Codex login did not complete.")
      return 1
    }

    console.log(`Persisted codex auth to ${file()}`)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}
