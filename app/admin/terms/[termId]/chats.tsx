"use client"
import { Badge } from "@/components/ui/badge"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { formatDateTime } from "@/lib/date"
import { cn } from "@/lib/utils"

type Chat = RouterOutput["admin"]["chats"][number]

export const Chats = ({
  termId,
  initialData
}: {
  termId: number
  initialData: Chat[]
}) => {
  const { data: chats } = trpc.admin.chats.useQuery(termId, {
    initialData
  })
  const firstUserId = chats.find((chat) => chat.role === "user")?.id
  const firstSystemId = chats.find((chat) => chat.role === "system")?.id

  return (
    <ol className="flex flex-col gap-4 px-5 py-5">
      {chats.map((chat) => (
        <li
          className={cn(
            "w-full max-w-[78%]",
            chat.role === "system" ? "self-start" : "self-end"
          )}
          key={chat.id}
        >
          <div
            className={cn(
              "mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
              chat.role === "user" && "justify-end"
            )}
          >
            {chat.role === "user" && chat.author?.name
              ? `User (${chat.author.name})`
              : chat.role === "system"
                ? "AI response"
                : "User"}
            {chat.id === firstUserId && (
              <Badge variant="outline" className="!py-0.5">
                Initial request
              </Badge>
            )}
            {chat.id === firstSystemId && (
              <Badge variant="outline" className="border-ai !py-0.5 text-ai">
                Initial response
              </Badge>
            )}
            {chat.role === "system" && chat.model && (
              <Badge
                variant="outline"
                className="border-ai !py-0.5 font-mono text-ai"
                title={
                  chat.promptKey
                    ? `prompt: ${chat.promptKey}`
                    : chat.promptHash
                      ? `prompt hash: ${chat.promptHash}`
                      : undefined
                }
              >
                {chat.model}
              </Badge>
            )}
          </div>
          <div
            className={cn(
              "w-full rounded-lg border p-3",
              chat.role === "system" ? "bg-card" : "bg-accent"
            )}
          >
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6">
              {chat.message}
            </pre>
          </div>
          <p
            className={cn(
              "mt-1 text-xs text-muted-foreground",
              chat.role === "user" && "text-right"
            )}
          >
            {formatDateTime(chat.createdAt)}
          </p>
        </li>
      ))}
      {!chats.length && (
        <li className="py-8 text-center text-sm text-muted-foreground">
          No generation conversation has been recorded.
        </li>
      )}
    </ol>
  )
}
