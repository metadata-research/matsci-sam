"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { trpc } from "@/trpc/client"
import { communityPath, studyPath } from "@/lib/public-identifiers"

/*
 * Accepting is a button press rather than something the page does on load, so
 * a mail scanner or a link prefetcher opening the URL cannot spend the
 * invitation on the invitee's behalf.
 *
 * The two invitation workflows accept through the same mutation but read
 * differently: a study invitation is about taking part, and joining the
 * community is incidental, so its labels lead with the study. An existing
 * member accepting a study invitation consumes it all the same, which is
 * what records that the person who was asked arrived.
 */
export const AcceptInvitation = ({
  token,
  forStudy = false,
  communityTitle
}: {
  token: string
  forStudy?: boolean
  communityTitle?: string
}) => {
  const router = useRouter()

  const { mutate: accept, isPending } = trpc.communities.accept.useMutation({
    onSuccess: ({ slug, studySlug, alreadyIn, nowWorkingIn }) => {
      toast.success(
        studySlug
          ? alreadyIn
            ? "Invitation recorded. Opening the study."
            : "You are in. Opening the study."
          : alreadyIn
            ? "You are already in this one"
            : nowWorkingIn
              ? `You joined ${communityTitle ?? "the community"}. ${nowWorkingIn} is now selected.`
              : communityTitle
                ? `You joined ${communityTitle}`
                : "You are in"
      )
      // A study invitation lands on the study, where the walkthrough
      // starts; a community invitation lands on the community.
      router.push(studySlug ? studyPath(studySlug) : communityPath(slug))
    },
    onError: (error) => toast.error(error.message)
  })

  return (
    <Button disabled={isPending} onClick={() => accept({ token })}>
      {isPending
        ? forStudy
          ? "Accepting…"
          : "Joining…"
        : forStudy
          ? "Accept and open the study"
          : communityTitle
            ? `Join ${communityTitle}`
            : "Accept and join"}
    </Button>
  )
}
