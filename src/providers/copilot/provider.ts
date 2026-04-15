import type { Adapter, Msg } from "../../core/contracts"
import { chat, responses } from "../../core/sse"
import { mapChatTools, mapResponseTools, toChatMessages, toResponseInput } from "../../core/variants"
import type { CopilotAuth } from "../../auth/contracts"

const CLIENT_ID = "Ov23li8tweQw6odWQebz"
const WAIT = 3000
const UA = "@pumpkinredbean/tiny-agent-runtime/0.0.0"

type Device = {
  verification_uri: string
  user_code: string
  device_code: string
  interval: number
}

type Poll = {
  access_token?: string
  error?: string
  interval?: number
}

function domain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function urls(url?: string) {
  const host = url ? domain(url) : "github.com"
  return {
    code: `https://${host}/login/device/code`,
    token: `https://${host}/login/oauth/access_token`,
  }
}

function base(url?: string) {
  return url ? `https://copilot-api.${domain(url)}` : "https://api.githubcopilot.com"
}

function headers(auth: CopilotAuth, last?: Msg) {
  return {
    Authorization: `Bearer ${auth.refresh}`,
    "Openai-Intent": "conversation-edits",
    "User-Agent": UA,
    "x-initiator": last?.role === "user" ? "user" : "agent",
  }
}

function use(model: string) {
  const hit = /^gpt-(\d+)/.exec(model)
  if (!hit) return "chat"
  return Number(hit[1]) >= 5 && !model.startsWith("gpt-5-mini") ? "responses" : "chat"
}

function max(model: string, n?: number) {
  if (model.includes("gpt")) return undefined
  return n
}

export const copilot: Adapter<CopilotAuth> & {
  device(url?: string): Promise<Device>
  poll(code: Device, url?: string): Promise<CopilotAuth | undefined>
  models(auth: CopilotAuth): Promise<string[]>
} = {
  id: "copilot",
  async device(url) {
    const res = await fetch(urls(url).code, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: "read:user",
      }),
    })
    if (!res.ok) throw new Error(`copilot device auth failed: ${res.status}`)
    return (await res.json()) as Device
  },
  async poll(code, url) {
    while (true) {
      const res = await fetch(urls(url).token, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": UA,
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: code.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })
      if (!res.ok) throw new Error(`copilot oauth poll failed: ${res.status}`)
      const data = (await res.json()) as Poll
      if (data.access_token) {
        return {
          type: "oauth",
          refresh: data.access_token,
          access: data.access_token,
          expires: 0,
          enterpriseUrl: url ? domain(url) : undefined,
        }
      }
      if (data.error === "authorization_pending") {
        await Bun.sleep(code.interval * 1000 + WAIT)
        continue
      }
      if (data.error === "slow_down") {
        await Bun.sleep((data.interval ?? code.interval + 5) * 1000 + WAIT)
        continue
      }
      return
    }
  },
  async models(auth) {
    const res = await fetch(`${base(auth.enterpriseUrl)}/models`, {
      headers: {
        Authorization: `Bearer ${auth.refresh}`,
        "User-Agent": UA,
      },
    })
    if (!res.ok) throw new Error(`copilot models failed: ${res.status}`)
    const data = (await res.json()) as {
      data?: Array<{ id?: string; model_picker_enabled?: boolean }>
    }
    return (data.data ?? [])
      .filter((item) => item.model_picker_enabled && typeof item.id === "string")
      .map((item) => item.id as string)
  },
  async prompt(auth, req) {
    const kind = use(req.model)
    const url = `${base(auth.enterpriseUrl)}/${kind === "chat" ? "chat/completions" : "responses"}`
    const res = await fetch(url, {
      method: "POST",
      signal: req.abort,
      headers: {
        "Content-Type": "application/json",
        ...headers(auth, req.msg[req.msg.length - 1]),
      },
      body: JSON.stringify(
        kind === "chat"
          ? {
              model: req.model,
              messages: toChatMessages(req.msg),
              tools: mapChatTools(req.tools),
              stream: true,
              max_tokens: max(req.model, req.max),
            }
          : {
              model: req.model,
              input: toResponseInput(req.msg),
              tools: mapResponseTools(req.tools),
              store: false,
              stream: true,
              max_output_tokens: max(req.model, req.max),
            },
      ),
    })
    if (!res.ok || !res.body) throw new Error(`copilot prompt failed: ${res.status}`)
    return {
      auth,
      model: req.model,
      url,
      events: kind === "chat" ? chat(res.body) : responses(res.body),
    }
  },
}
