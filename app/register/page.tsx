import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"
import { UserRoundPlusIcon } from "lucide-react"
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
import { getAccountCreationMethods } from "@/lib/account-creation"
import { getCurrentUser } from "@/lib/current-user"
import { isDevAuthEnabled } from "@/lib/dev-auth"
import { ORCID_SIGN_IN_CANCELLED_NOTICE } from "@/lib/orcid"
import { SITE_NAME } from "@/lib/site"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

export const metadata: Metadata = {
  title: `Create an account | ${SITE_NAME}`
}

export default async function RegisterPage({
  searchParams
}: {
  searchParams: Promise<{ source?: string; returnTo?: string; orcid?: string }>
}) {
  const { source, returnTo: requestedReturnTo, orcid } = await searchParams
  const returnTo = normalizeAuthReturnTo(requestedReturnTo)
  if (await getCurrentUser()) redirect(returnTo ?? "/profile")
  const methods = getAccountCreationMethods()
  const signupEnabled = methods.google || methods.orcid || methods.email
  const devEnabled = isDevAuthEnabled()
  const showProviders = methods.google || methods.orcid || devEnabled
  const orcidRecovery = methods.orcid
    ? "Create an account with ORCID, or sign in to an existing account and connect ORCID from your profile."
    : signupEnabled
      ? "Create an account below, or sign in to an existing account, then connect ORCID from your profile."
      : "Sign in to your existing account with another method, then connect ORCID from your profile."

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserRoundPlusIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">Create an account</CardTitle>
          <CardDescription className="leading-6">
            {signupEnabled
              ? "Choose how to create your account."
              : "Account creation is unavailable on this site."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {source === "orcid" ? (
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-5">
              This ORCID iD is not connected to an account. {orcidRecovery}
            </p>
          ) : null}
          {orcid === "cancelled" ? (
            <p
              role="status"
              className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-5"
            >
              {ORCID_SIGN_IN_CANCELLED_NOTICE}
            </p>
          ) : null}
          {methods.google ? (
            <Button asChild className="w-full">
              <a href={authPathWithReturnTo("/api/auth/google", returnTo)}>
                Create account with Google
              </a>
            </Button>
          ) : devEnabled ? (
            <Button variant="outline" className="w-full" disabled>
              Create account with Google
              <span className="ml-auto text-xs font-normal">Unavailable</span>
            </Button>
          ) : null}
          {methods.orcid ? (
            <Button asChild variant="outline" className="w-full">
              <a
                href={authPathWithReturnTo(
                  "/api/auth/orcid?intent=signup",
                  returnTo
                )}
              >
                <Image src="/orcid-id.svg" alt="" width={18} height={18} />
                Create account with ORCID
              </a>
            </Button>
          ) : devEnabled ? (
            <Button variant="outline" className="w-full" disabled>
              <Image src="/orcid-id.svg" alt="" width={18} height={18} />
              Create account with ORCID
              <span className="ml-auto text-xs font-normal">Unavailable</span>
            </Button>
          ) : null}
          {methods.email ? (
            <>
              {showProviders ? (
                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" aria-hidden />
                  Or use email
                  <span className="h-px flex-1 bg-border" aria-hidden />
                </div>
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
                    aria-describedby="registration-email-help"
                  />
                  <p
                    id="registration-email-help"
                    className="text-xs text-muted-foreground"
                  >
                    We will email you a one-time link. No password is required.
                  </p>
                </div>
                <Button type="submit" className="w-full">
                  Create account with email
                </Button>
              </form>
            </>
          ) : null}
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href={authPathWithReturnTo("/login", returnTo)}
              className="text-primary underline"
            >
              Sign in
            </Link>{" "}
            to keep your work together.
          </p>
          {devEnabled ? (
            <Button asChild variant="ghost" className="w-full">
              <Link href={authPathWithReturnTo("/dev-login", returnTo)}>
                Use development sign-in
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
