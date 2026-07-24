"use client"

import { Button } from "@/components/ui/button"
import { trpc } from "@/trpc/client"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export const RunButton = ({
  termId,
  canRun
}: {
  termId: number
  canRun: boolean
}) => {
  const router = useRouter()
  const utils = trpc.useUtils()

  const { mutate, isPending } = trpc.admin.run.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.chats.invalidate(termId),
        utils.admin.terms.invalidate()
      ])
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  return (
    <Button disabled={isPending || !canRun} onClick={() => mutate(termId)}>
      {isPending
        ? "Generating definition"
        : canRun
          ? "Run AI generation"
          : "No request waiting"}
    </Button>
  )
}
