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
import { isEmailAccountCreationEnabled } from "@/lib/email-auth"
import { SITE_NAME } from "@/lib/site"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

export const metadata: Metadata = {
  title: `Create an account | ${SITE_NAME}`
}

export default async function RegisterPage({
  searchParams
}: {
  searchParams: Promise<{ source?: string; returnTo?: string }>
}) {
  if (!isEmailAccountCreationEnabled()) notFound()
  const { source, returnTo: requestedReturnTo } = await searchParams
  const returnTo = normalizeAuthReturnTo(requestedReturnTo)

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">
            Create an account or sign in
          </CardTitle>
          <CardDescription className="leading-6">
            Enter your email address. We will send a short-lived, one-time link
            that confirms the address and creates your account. No password is
            required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {source === "orcid" ? (
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-5">
              That ORCID iD is not connected to an account yet. Verify your
              email first, then connect ORCID from your profile.
            </p>
          ) : null}
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-5">
            Already have contributions here? Continue with the same Google
            account first so your existing work stays attached to your account.
            Email registration is for new contributors.
          </p>
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
              Create account by email
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Prefer your existing identity?{" "}
            <a
              href={authPathWithReturnTo("/api/auth/google", returnTo)}
              className="text-primary underline"
            >
              Continue with Google
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
