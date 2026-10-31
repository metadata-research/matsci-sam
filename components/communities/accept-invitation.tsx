"use client"

import { useState } from "react"
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
  const [accepted, setAccepted] = useState<{
    href: string
    message: string
  } | null>(null)

  const { mutate: accept, isPending } = trpc.communities.accept.useMutation({
    onSuccess: ({ slug, studySlug, alreadyIn, nowWorkingIn }) => {
      const message = studySlug
        ? alreadyIn
          ? "Invitation recorded. Opening the study."
          : "You are in. Opening the study."
        : alreadyIn
          ? "You are already a member."
          : nowWorkingIn
            ? `You joined ${communityTitle ?? "the community"}. ${nowWorkingIn} is now selected.`
            : communityTitle
              ? `You joined ${communityTitle}.`
              : "You joined the community."
      const href = studySlug ? studyPath(studySlug) : communityPath(slug)
      setAccepted({ href, message })
      toast.success(message)
      // Membership changes both page permissions and the selected community.
      // Load a fresh document, as the community switcher does, so cached
      // nonmember content and header state are not reused.
      window.location.assign(href)
    },
    onError: (error) => toast.error(error.message)
  })

  if (accepted)
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm">
          {accepted.message}
        </p>
        <Button asChild>
          <a href={accepted.href}>
            {forStudy ? "Open study" : "Open community"}
          </a>
        </Button>
      </div>
    )

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
