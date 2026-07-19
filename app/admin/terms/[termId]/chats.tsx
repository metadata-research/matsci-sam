"use client";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/trpc/client";
import { format } from "date-fns"

export const Chats = ({ termId }: { termId: number }) => {
  const { data: chats } = trpc.admin.chats.useQuery(termId, {
    initialData: [],
  });


  return (
    <section className="flex flex-col">
      {chats.map((chat, index) => (
        <div
          style={{
            alignSelf: chat.role === "system" ? "self-start" : "self-end",
          }}
          className="min-w-1/3 max-w-3/4"
          key={chat.id}
        >
          <div className="flex items-center gap-2">
            {chat.role}
            {index === 0 && <Badge className="bg-green-500 !py-0.5">initial message</Badge>}
            {index === 1 && <Badge className="bg-red-500 !py-0.5 ">initial definition</Badge>}
            {chat.role === "system" && chat.model && (
              <Badge
                variant="secondary"
                className="!py-0.5 font-mono"
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
          <div className="p-2 bg-accent w-full rounded-md">
            <pre className="text-wrap ">{chat.message}</pre>
          </div>
          <p className="text-xs opacity-80" style={{ textAlign: chat.role === 'system' ? 'left' : 'right' }}>{format(chat.createdAt, 'MM/dd/yyyy h:mm aaa')}</p>
        </div>
      ))}
    </section>
  );
};
