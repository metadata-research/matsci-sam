import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { MailCheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  isEmailAccountCreationEnabled,
  isEmailAuthEnabled
} from "@/lib/email-auth"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = { title: `Check your email | ${SITE_NAME}` }

export default async function CheckEmailPage({
  searchParams
}: {
  searchParams: Promise<{
    intent?: string | string[]
    returnTo?: string | string[]
  }>
}) {
  if (!isEmailAuthEnabled()) notFound()
  const emailAccountCreationEnabled = isEmailAccountCreationEnabled()
  const { intent, returnTo: requestedReturnTo } = await searchParams
  const returnTo = normalizeAuthReturnTo(requestedReturnTo)
  const isCreatingAccount = intent === "create" && emailAccountCreationEnabled
  const isSigningIn = intent === "sign-in"
  const title = isCreatingAccount
    ? "Check your email to create your account"
    : isSigningIn
      ? "Check your email to sign in"
      : "Check your email"
  const description = isCreatingAccount
    ? "Open the one-time link to confirm your email address and create your account. No password is required."
    : isSigningIn
      ? "If this email address belongs to an account, you will receive a one-time link to sign in."
      : "Open the one-time link to continue."

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailCheckIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="leading-6">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Check your inbox and spam folder. Links expire shortly and work only
            once.
          </p>
          {isSigningIn && emailAccountCreationEnabled ? (
            <p className="text-sm text-muted-foreground">
              New here?{" "}
              <Link
                href={authPathWithReturnTo("/register", returnTo)}
                className="text-primary underline"
              >
                Create an account with email
              </Link>
              . No password is required.
            </p>
          ) : null}
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Return home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
