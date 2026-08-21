"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { trpc } from "@/trpc/client"
import { communityPath } from "@/lib/public-identifiers"

/*
 * Accepting is a button press rather than something the page does on load, so
 * a mail scanner or a link prefetcher opening the URL cannot spend the
 * invitation on the invitee's behalf.
 */
export const AcceptInvitation = ({ token }: { token: string }) => {
  const router = useRouter()

  const { mutate: accept, isPending } = trpc.communities.accept.useMutation({
    onSuccess: ({ slug, alreadyIn, nowWorkingIn }) => {
      toast.success(
        alreadyIn
          ? "You are already in this one"
          : nowWorkingIn
            ? `You are in, and now working in ${nowWorkingIn}`
            : "You are in"
      )
      router.push(communityPath(slug))
    },
    onError: (error) => toast.error(error.message)
  })

  return (
    <Button disabled={isPending} onClick={() => accept({ token })}>
      {isPending ? "Joining…" : "Accept and join"}
    </Button>
  )
}
