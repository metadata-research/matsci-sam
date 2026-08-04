"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { toast } from "sonner"

// One logged-out prompt for every interaction, so voting, commenting, and
// suggesting read as the same system. Pass the verb: "vote", "comment",
// "suggest a revision".
export const loginToast = (action: string) =>
  toast(`You must be logged in to ${action}!`, {
    action: (
      <Button asChild>
        <Link href="/login" className="ml-auto">
          Login
        </Link>
      </Button>
    ),
    position: "top-center"
  })
