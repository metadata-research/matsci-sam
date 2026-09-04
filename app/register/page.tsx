import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { MailIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isGoogleAuthConfigured } from "@/lib/apis/google"
import { isEmailAccountCreationEnabled } from "@/lib/email-auth"
import { SITE_NAME } from "@/lib/site"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

export const metadata: Metadata = {
  title: `Create an account with email | ${SITE_NAME}`
}

export default async function RegisterPage({
  searchParams
}: {
  searchParams: Promise<{ source?: string; returnTo?: string }>
}) {
  if (!isEmailAccountCreationEnabled()) notFound()
  const { source, returnTo: requestedReturnTo } = await searchParams
  const returnTo = normalizeAuthReturnTo(requestedReturnTo)
  const googleEnabled = isGoogleAuthConfigured()

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">
            Create an account with email
          </CardTitle>
          <CardDescription className="leading-6">
            Enter your email address and we will send a one-time link to confirm
            it and create your account. No password is required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {source === "orcid" ? (
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-5">
              That ORCID iD is not connected to an account yet. Verify your
              email first, then connect ORCID from your profile.
            </p>
          ) : null}
          {googleEnabled ? (
            <>
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-5">
                Already participated? Use the same Google account you used
                before so your existing work stays connected. Email registration
                is for new contributors.
              </p>
              <Button asChild variant="outline" className="w-full">
                <a href={authPathWithReturnTo("/api/auth/google", returnTo)}>
                  Continue with Google instead
                </a>
              </Button>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" aria-hidden />
                Or create with email
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
            </>
          ) : null}
          <form
            action="/api/auth/email/start"
            method="post"
            className="space-y-4"
          >
            <input type="hidden" name="intent" value="create" />
            {returnTo ? (
              <input type="hidden" name="returnTo" value={returnTo} />
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="registration-email">Email address</Label>
              <Input
                id="registration-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Create account with email
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
