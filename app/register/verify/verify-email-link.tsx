"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"

export function VerifyEmailLink() {
  const router = useRouter()
  const [error, setError] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    const verify = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1))
      const token = hash.get("token")
      const returnTo = hash.get("returnTo")
      window.history.replaceState(null, "", window.location.pathname)

      if (!token) throw new Error("This sign-in link is invalid.")

      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, returnTo }),
        signal: controller.signal
      })

      const result = (await response.json()) as {
        error?: string
        redirectTo?: string
      }
      if (!response.ok || !result.redirectTo)
        throw new Error(result.error || "The sign-in link could not be used.")

      router.replace(result.redirectTo)
      router.refresh()
    }

    queueMicrotask(() => {
      if (!active) return

      void verify().catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return
        setError(
          reason instanceof Error
            ? reason.message
            : "The sign-in link could not be used."
        )
      })
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [router])

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Verifying your email</CardTitle>
          <CardDescription>
            The link is being checked and will sign you in automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="space-y-4">
              <p
                role="alert"
                className="flex items-start gap-2 text-sm text-destructive"
              >
                <CircleAlertIcon
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
                {error}
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Request another link</Link>
              </Button>
            </div>
          ) : (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              aria-live="polite"
            >
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
              Verifying…
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
