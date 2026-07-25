export interface YAMZSession {
  id?: number
  googleOAuthState?: string
  orcidOAuth?: {
    state: string
    nonce: string
    codeVerifier: string
    intent: "connect" | "login"
    startedAt: number
  }
}
