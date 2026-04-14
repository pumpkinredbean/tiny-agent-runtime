export type OAuth = {
  refresh: string
  access: string
  expires: number
}

export type CopilotAuth = OAuth & {
  enterpriseUrl?: string
}

export type CodexAuth = OAuth & {
  accountId?: string
}
