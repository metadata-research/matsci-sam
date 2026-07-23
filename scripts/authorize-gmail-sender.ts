import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { google } from "googleapis"

const callbackPort = 53682
const callbackPath = "/oauth2callback"
const callbackUrl = `http://localhost:${callbackPort}${callbackPath}`
const gmailSendScope = "https://www.googleapis.com/auth/gmail.send"
const clientFile =
  process.env.MATSCI_GMAIL_CLIENT_FILE ||
  join(homedir(), ".config/matsci-sam/google-mail-oauth-client.json")
const tokenFile =
  process.env.MATSCI_GMAIL_TOKEN_FILE ||
  join(homedir(), ".config/matsci-sam/google-mail-token.json")

type OAuthClientFile = {
  web?: {
    client_id?: string
    client_secret?: string
    redirect_uris?: string[]
  }
}

const main = async () => {
  const clientDocument = JSON.parse(
    await readFile(clientFile, "utf8")
  ) as OAuthClientFile
  const client = clientDocument.web

  if (!client?.client_id || !client.client_secret)
    throw new Error("The OAuth client JSON does not contain web credentials")
  if (!client.redirect_uris?.includes(callbackUrl))
    throw new Error(
      `The OAuth client must include the redirect URI ${callbackUrl}`
    )

  const oauth = new google.auth.OAuth2(
    client.client_id,
    client.client_secret,
    callbackUrl
  )
  const state = randomBytes(32).toString("base64url")
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [gmailSendScope],
    state
  })

  let closeServer: (() => void) | undefined
  const completion = new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url || "/", callbackUrl)
        if (requestUrl.pathname !== callbackPath) {
          response.writeHead(404).end("Not found")
          return
        }

        const error = requestUrl.searchParams.get("error")
        const returnedState = requestUrl.searchParams.get("state")
        const code = requestUrl.searchParams.get("code")

        if (error) throw new Error(`Google authorization failed: ${error}`)
        if (returnedState !== state)
          throw new Error("Google authorization returned an invalid state")
        if (!code) throw new Error("Google authorization did not return a code")

        const { tokens } = await oauth.getToken(code)
        if (!tokens.refresh_token)
          throw new Error(
            "Google did not return a refresh token; revoke the app grant and try again"
          )

        await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 })
        await writeFile(
          tokenFile,
          `${JSON.stringify(
            {
              refresh_token: tokens.refresh_token,
              scope: gmailSendScope,
              created_at: new Date().toISOString()
            },
            null,
            2
          )}\n`,
          { encoding: "utf8", mode: 0o600 }
        )
        await chmod(tokenFile, 0o600)

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        response.end(
          "<!doctype html><title>MatSci SAM mail authorization</title>" +
            "<h1>Authorization complete</h1>" +
            "<p>The Gmail refresh token was stored securely in WSL. " +
            "You may close this window and return to Codex.</p>"
        )
        console.log(
          `Authorization complete. Token stored at ${tokenFile} with owner-only permissions.`
        )
        server.close(() => resolve())
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        response.end(
          error instanceof Error ? error.message : "Authorization failed"
        )
        server.close(() => reject(error))
      }
    })

    closeServer = () => server.close()
    server.on("error", reject)
    server.listen(callbackPort, "127.0.0.1", () => {
      console.log("Authorize the Systemada account that owns the sender alias.")
      console.log("Open this URL in your normal browser:")
      console.log("")
      console.log(authorizationUrl)
      console.log("")
      console.log("Waiting for the Google callback...")
    })
  })

  let timeoutTimer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(
      () => {
        closeServer?.()
        reject(new Error("Authorization timed out after 10 minutes"))
      },
      10 * 60 * 1000
    )
    timeoutTimer.unref()
  })

  try {
    await Promise.race([completion, timeout])
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
