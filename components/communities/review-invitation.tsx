"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
export function AcceptReviewInvitation({ token }: { token: string }) {
  const accept = trpc.communityReviews.acceptInvitation.useMutation()
  const router = useRouter()
  const [error, setError] = useState("")
  return (
    <>
      <Button
        disabled={accept.isPending}
        onClick={async () => {
          setError("")
          try {
            const result = await accept.mutateAsync({ token })
            router.push(result.href)
            router.refresh()
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not join the review."
            )
          }
        }}
      >
        {accept.isPending ? "Joining…" : "Join community and open review"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
