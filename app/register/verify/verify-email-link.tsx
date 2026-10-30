"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { normalizeAuthReturnTo } from "@/lib/auth-return"

type LinkInput = { token: string | null; returnTo: string | null }
type Confirmation = {
  email: string
  challenge: string
  createsAccount: boolean
  switchesAccount: boolean
}

export function VerifyEmailLink() {
  const input = useRef<LinkInput | null>(null)
  const submitting = useRef(false)
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)
  const [returnTo, setReturnTo] = useState<string | null>(null)

  const prepare = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    setConfirmation(undefined)
    try {
      if (!input.current?.token)
        throw new Error("This sign-in link is invalid.")
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        credentials: "same-origin",
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input.current, action: "prepare" })
      })
      const result = await response.json()
      if (!response.ok || !result.challenge || !result.email)
        throw new Error(
          result.error || "The sign-in link could not be checked."
        )
      setConfirmation(result)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The sign-in link could not be checked."
      )
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    // Deferring initialization avoids issuing twice during React's effect replay.
    queueMicrotask(() => {
      if (!active) return
      if (!input.current) {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        input.current = {
          token: hash.get("token"),
          returnTo: hash.get("returnTo")
        }
        setReturnTo(normalizeAuthReturnTo(input.current.returnTo))
        window.history.replaceState(null, "", window.location.pathname)
      }
      void prepare()
    })
    return () => {
      active = false
    }
  }, [prepare])

  const confirm = async () => {
    if (submitting.current || !confirmation) return
    submitting.current = true
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        credentials: "same-origin",
        referrerPolicy: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input.current,
          action: "confirm",
          challenge: confirmation.challenge
        })
      })
      const result = await response.json()
      if (!response.ok || !result.redirectTo) {
        if (response.status === 409) setConfirmation(undefined)
        throw new Error(result.error || "The sign-in link could not be used.")
      }
      // Load the destination with the confirmed session and no cached account UI.
      window.location.replace(result.redirectTo)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The sign-in link could not be used."
      )
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">
            {confirmation?.createsAccount
              ? "Confirm your account"
              : "Confirm sign-in"}
          </CardTitle>
          <CardDescription>
            {confirmation
              ? "Check the email address before continuing."
              : "Checking your email link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {confirmation && (
            <>
              <p className="break-all font-medium">{confirmation.email}</p>
              {confirmation.switchesAccount && (
                <p className="text-sm text-muted-foreground">
                  You are signed in to another account. Continuing will switch
                  accounts.
                </p>
              )}
              <Button className="w-full" onClick={confirm} disabled={busy}>
                {confirmation.createsAccount
                  ? "Create account and continue"
                  : confirmation.switchesAccount
                    ? "Switch account and continue"
                    : "Sign in and continue"}
              </Button>
            </>
          )}
          {busy && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
              {confirmation ? "Signing in…" : "Checking link…"}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {error && !confirmation && (
            <Button
              variant="outline"
              className="w-full"
              onClick={prepare}
              disabled={busy}
            >
              Check link again
            </Button>
          )}
          <Button asChild variant="outline" className="w-full">
            <a href={returnTo ?? "/"}>Cancel</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
