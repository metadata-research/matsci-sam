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
import { ModelRevisionDisclosure } from "@/components/comments/model-revision-disclosure"
import { useCreateComment } from "@/components/comments/use-create-comment"
import { MessageSquareIcon } from "lucide-react"
import { Card } from "../ui/card"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"

const commentSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(
      COMMENT_MAX_LENGTH,
      `Comment must be ${COMMENT_MAX_LENGTH.toLocaleString()} characters or fewer`
    )
})

export function TermCommentBox({
  id,
  revisionId,
  feedsModelRevision = false
}: {
  id: number
  revisionId: number
  // True when the definition is AI-authored, where a comment on the current
  // revision is also sent to the model for its next revision. Disclosed up
  // front, matching the discussion page, rather than only after posting.
  feedsModelRevision?: boolean
}) {
  const form = useForm<z.infer<typeof commentSchema>>({
    resolver: zodResolver(commentSchema),
    defaultValues: {
      message: ""
    }
  })

  const { isPending, mutate } = useCreateComment({
    definitionId: id,
    onPosted: () => form.reset()
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
                    maxLength={COMMENT_MAX_LENGTH}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex items-center justify-between gap-3">
            {feedsModelRevision ? <ModelRevisionDisclosure /> : <span />}
            <Button type="submit" disabled={isPending}>
              <MessageSquareIcon aria-hidden />
              {isPending ? "Posting…" : "Post comment"}
            </Button>
          </div>
        </Card>
      </form>
    </Form>
  )
}
