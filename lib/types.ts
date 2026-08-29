export interface YAMZSession {
  id?: number
  googleOAuthState?: string
  authReturnTo?: string
  orcidOAuth?: {
    state: string
    nonce: string
    codeVerifier: string
    intent: "connect" | "login"
    startedAt: number
    returnTo?: string
  }
}
