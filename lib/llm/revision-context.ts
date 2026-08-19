import type { Message } from "ollama"

export interface RevisionChatMessage {
  role: "system" | "user"
  message: string
}

export interface AIDefinitionContext {
  term: string
  definition: string
  example: string
}

export const needsReconstructedDefinitionContext = (
  chats: RevisionChatMessage[]
) =>
  chats[0]?.role === "user" &&
  chats[0].message.trimStart().startsWith("<feedback>")

export const buildRevisionMessages = (
  chats: RevisionChatMessage[],
  context?: AIDefinitionContext
): Message[] => {
  const messages: Message[] = chats.map((chat) => ({
    role: chat.role,
    content: chat.message
  }))

  if (!needsReconstructedDefinitionContext(chats)) return messages
  if (!context)
    throw new Error(
      "The current AI definition is unavailable for this feedback-only chat thread"
    )

  return [
    {
      role: "user",
      content: `<term>\n${context.term}\n\n<definition>\n${context.definition}\n\n<example>\n${context.example}`
    },
    ...messages
  ]
}
