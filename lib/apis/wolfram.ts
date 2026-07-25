import "server-only"

// Wolfram AgentOne chat completions API. Mirrors the OntServe integration:
// raw API key in the Authorization header, OpenAI-style message payload.
// https://www.wolfram.com/apis/documentation/cag/wolfram-agent-one-api/
const AGENTONE_ENDPOINT =
  "https://services.wolfram.com/api/agent-one/v1/chat/completions"

export const wolframConfigured = () => Boolean(process.env.WOLFRAM_API_KEY)

// Masked key for admin display, e.g. "****abcd"
export const wolframMaskedKey = () => {
  const key = process.env.WOLFRAM_API_KEY
  if (!key) return null

  return `****${key.slice(-4)}`
}

export type WolframMessage = { role: "user" | "assistant"; content: string }

export const wolframQuery = async (
  message: string,
  history: WolframMessage[] = []
) => {
  const apiKey = process.env.WOLFRAM_API_KEY
  if (!apiKey) throw new Error("WOLFRAM_API_KEY is not configured")

  const res = await fetch(AGENTONE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey
    },
    body: JSON.stringify({
      messages: [...history, { role: "user", content: message }],
      stream: false
    })
  })

  if (res.status === 403)
    throw new Error("Invalid or missing Wolfram API key (HTTP 403)")
  if (res.status === 501)
    throw new Error("Wolfram could not process the input (HTTP 501)")
  if (!res.ok)
    throw new Error(
      `Wolfram API returned HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
    )

  const data = await res.json()
  const content: string | undefined = data.choices?.[0]?.message?.content
  if (!content) throw new Error("Empty response from Wolfram AgentOne")

  return content
}
