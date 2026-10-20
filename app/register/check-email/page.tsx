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
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = { title: `Check your email | ${SITE_NAME}` }

export default function CheckEmailPage() {
  if (!isEmailAuthEnabled()) notFound()
  const emailAccountCreationEnabled = isEmailAccountCreationEnabled()

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailCheckIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <CardDescription className="leading-6">
            Check your inbox and spam folder for a one-time link. Sign-in links
            are sent only for existing accounts. Links expire shortly and work
            only once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {emailAccountCreationEnabled ? (
            <p className="text-sm text-muted-foreground">
              Use{" "}
              <Link href="/register" className="text-primary underline">
                Create an account with email
              </Link>{" "}
              if you requested a sign-in link but do not have an account. No
              password is required.
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
