"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage
} from "@/components/ui/form"
import { Textarea } from "../ui/textarea"
import { trpc } from "@/trpc/client"
import Link from "next/link"
import { toast } from "sonner"
import { MessageSquareIcon } from "lucide-react"
import { Card } from "../ui/card"

const commentSchema = z.object({
  message: z.string().nonempty({ message: "Comment cannot be empty" })
})

export function TermCommentBox({
  id,
  revisionId
}: {
  id: number
  revisionId: number
}) {
  const utils = trpc.useUtils()

  // 1. Define your form.
  const form = useForm<z.infer<typeof commentSchema>>({
    resolver: zodResolver(commentSchema),
    defaultValues: {
      message: ""
    }
  })

  const { isPending, mutate } = trpc.comments.create.useMutation({
    onSettled: () => {
      form.reset()

      utils.comments.get.refetch(id)
    },
    onError: () =>
      toast("You must be logged in to comment!", {
        action: (
          <Link href="/api/login" className="ml-auto">
            <Button>Login</Button>
          </Link>
        ),
        position: "top-center"
      })
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) =>
          mutate({ id, revisionId, comment: data.message })
        )}
        className="space-y-3"
      >
        <Card className="gap-3 p-4 shadow-none sm:p-5">
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    aria-label="Comment"
                    placeholder="Add a comment"
                    className="min-h-28 resize-y bg-background"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              <MessageSquareIcon aria-hidden />
              {isPending ? "Posting..." : "Post comment"}
            </Button>
          </div>
        </Card>
      </form>
    </Form>
  )
}
