export interface YAMZSession {
  id?: number
  emailAuthConfirmation?: import("./email-auth-confirmation").EmailAuthConfirmation
  googleOAuthState?: string
  authReturnTo?: string
  orcidOAuth?: {
    state: string
    nonce: string
    codeVerifier: string
    intent: "connect" | "login" | "signup"
    initiatingUserId?: number
    startedAt: number
    returnTo?: string
  }
}
