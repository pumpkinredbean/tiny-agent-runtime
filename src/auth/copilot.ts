import type { CopilotAuth } from "./contracts"
import { file, set } from "./store"
import { copilot } from "../provider/copilot"

export type CopilotDeviceCode = Awaited<ReturnType<(typeof copilot)["device"]>>

type LoginDeps = {
  device(url?: string): Promise<CopilotDeviceCode>
  poll(code: CopilotDeviceCode, url?: string): Promise<CopilotAuth | undefined>
  set(id: "copilot", auth: CopilotAuth): Promise<void>
}

export type CopilotLoginOptions = {
  enterpriseUrl?: string
  onVerification?(device: CopilotDeviceCode): void
}

const deps: LoginDeps = {
  device: (url) => copilot.device(url),
  poll: (code, url) => copilot.poll(code, url),
  set,
}

export function normalizeEnterpriseUrl(url?: string) {
  const value = url?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return value ? value : undefined
}

function normalizeAuth(auth: CopilotAuth): CopilotAuth {
  return {
    ...auth,
    enterpriseUrl: normalizeEnterpriseUrl(auth.enterpriseUrl),
  }
}

export async function loginCopilot(opts: CopilotLoginOptions = {}, input: LoginDeps = deps) {
  const enterpriseUrl = normalizeEnterpriseUrl(opts.enterpriseUrl)
  const device = await input.device(enterpriseUrl)
  opts.onVerification?.(device)

  const auth = await input.poll(device, enterpriseUrl)
  if (!auth) return

  const next = normalizeAuth(auth)
  await input.set("copilot", next)
  return next
}

function target(argv: string[], env: NodeJS.ProcessEnv) {
  return normalizeEnterpriseUrl(argv[0] ?? env.RUNTIME_COPILOT_ENTERPRISE_URL)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const enterpriseUrl = target(argv, env)

  try {
    const auth = await loginCopilot({
      enterpriseUrl,
      onVerification(device) {
        console.log(`Open ${device.verification_uri}`)
        console.log(`Enter code: ${device.user_code}`)
        console.log("Waiting for Copilot authorization...")
      },
    })

    if (!auth) {
      console.error("Copilot login did not complete.")
      return 1
    }

    console.log(`Persisted copilot auth to ${file()}`)
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}
