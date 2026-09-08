"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { studyRunPath } from "@/lib/public-identifiers"

export function JoinStudy({
  studySlug,
  communityTitle
}: {
  studySlug: string
  communityTitle: string
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const join = trpc.surveys.join.useMutation({
    onSuccess: async ({ studySlug }) => {
      await utils.surveys.get.invalidate({ studySlug })
      router.push(studyRunPath(studySlug))
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })
  return (
    <div className="space-y-3">
      <p className="text-sm">
        You’re welcome to take part. Joining adds you to {communityTitle} and
        opens the study. No invitation is needed.
      </p>
      <Button
        className="bg-red-600 text-white hover:bg-red-700"
        disabled={join.isPending}
        onClick={() => join.mutate({ studySlug })}
      >
        {join.isPending ? "Joining…" : "Join and begin study"}
      </Button>
    </div>
  )
}
