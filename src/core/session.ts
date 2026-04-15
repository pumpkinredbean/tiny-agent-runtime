import type { Msg } from "./contracts"

export type SessionTurn = {
  role: "user" | "assistant"
  content: string
}

export type SessionState = {
  id?: string
  transcript: Msg[]
}

export type SessionInput = {
  id?: string
  transcript?: Msg[]
  history?: SessionTurn[]
}

export type SessionRunConfig = {
  system?: string
}

export type PromptInput = SessionInput & {
  system?: string
  prompt: string
}

function transcript(input: SessionInput): Msg[] {
  if (input.transcript) return [...input.transcript]
  return [...(input.history ?? [])]
}

export function assembleMessages(input: { transcript?: Msg[]; system?: string }): Msg[] {
  return [
    ...(input.system ? [{ role: "system", content: input.system } satisfies Msg] : []),
    ...(input.transcript ?? []),
  ]
}

export function createSession(input: SessionInput = {}): SessionState {
  return {
    id: input.id,
    transcript: transcript(input),
  }
}

export function sessionMessages(session: SessionState, run: SessionRunConfig = {}): Msg[] {
  return assembleMessages({ transcript: session.transcript, system: run.system })
}

export function appendMessage(session: SessionState, msg: Msg): SessionState {
  return { ...session, transcript: [...session.transcript, msg] }
}

export function appendUserText(session: SessionState, content: string): SessionState {
  return appendMessage(session, { role: "user", content })
}

export function appendAssistantText(session: SessionState, content: string): SessionState {
  return appendMessage(session, { role: "assistant", content })
}

export function promptMessages(input: PromptInput): Msg[] {
  return sessionMessages(appendUserText(createSession(input), input.prompt), { system: input.system })
}
