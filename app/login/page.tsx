import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"
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
import { isDevAuthEnabled } from "@/lib/dev-auth"
import {
  isEmailAccountCreationEnabled,
  isEmailAuthEnabled
} from "@/lib/email-auth"
import { isOrcidAuthEnabled } from "@/lib/apis/orcid"
import { isGoogleAuthConfigured } from "@/lib/apis/google"
import { SITE_NAME } from "@/lib/site"
import { getCurrentUser } from "@/lib/current-user"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

export const metadata: Metadata = {
  title: `Continue to ${SITE_NAME}`
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { returnTo: requestedReturnTo } = await searchParams
  const returnTo = normalizeAuthReturnTo(requestedReturnTo)
  // Someone already signed in has nothing to do here, and on a host with
  // email account creation this page would offer them a second account.
  if (await getCurrentUser()) redirect(returnTo ?? "/profile")

  const devEnabled = isDevAuthEnabled()
  const googleEnabled = isGoogleAuthConfigured()
  const emailEnabled = isEmailAuthEnabled()
  const emailAccountCreationEnabled = isEmailAccountCreationEnabled()
  const orcidEnabled = isOrcidAuthEnabled()

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Continue to {SITE_NAME}</CardTitle>
          <CardDescription>
            Choose how you want to continue. If you have participated before,
            use the same method so your work stays connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {googleEnabled ? (
            <Button asChild className="w-full">
              <a href={authPathWithReturnTo("/api/auth/google", returnTo)}>
                Continue with Google
              </a>
            </Button>
          ) : (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled
                aria-describedby="google-unavailable"
              >
                Continue with Google
                <span className="ml-auto text-xs font-normal">Unavailable</span>
              </Button>
              <p
                id="google-unavailable"
                className="text-center text-xs text-muted-foreground"
              >
                Google sign-in is not configured on this site.
              </p>
            </div>
          )}
          {orcidEnabled ? (
            <Button asChild variant="outline" className="w-full">
              <a
                href={authPathWithReturnTo(
                  "/api/auth/orcid?intent=login",
                  returnTo
                )}
              >
                <Image
                  src="/orcid-id.svg"
                  alt=""
                  width={18}
                  height={18}
                  aria-hidden
                />
                Continue with ORCID
              </a>
            </Button>
          ) : (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled
                aria-describedby="orcid-unavailable"
              >
                <Image
                  src="/orcid-id.svg"
                  alt=""
                  width={18}
                  height={18}
                  aria-hidden
                />
                Continue with ORCID
                <span className="ml-auto text-xs font-normal">Coming soon</span>
              </Button>
              <p
                id="orcid-unavailable"
                className="text-center text-xs text-muted-foreground"
              >
                ORCID sign-in is not available yet.
              </p>
            </div>
          )}
          {emailEnabled ? (
            <>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" aria-hidden />
                Or use email
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
              <form
                action="/api/auth/email/start"
                method="post"
                className="space-y-4"
              >
                <input type="hidden" name="intent" value="sign-in" />
                {returnTo ? (
                  <input type="hidden" name="returnTo" value={returnTo} />
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email address</Label>
                  <div className="relative">
                    <MailIcon
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="login-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      maxLength={254}
                      required
                      className="pl-9"
                      aria-describedby="login-email-help"
                    />
                  </div>
                  <p
                    id="login-email-help"
                    className="text-xs text-muted-foreground"
                  >
                    If an account exists for this address, MatSci-SAM will email
                    a one-time sign-in link.
                  </p>
                </div>
                <Button type="submit" className="w-full">
                  Email me a sign-in link
                </Button>
              </form>
              {emailAccountCreationEnabled ? (
                <p className="text-center text-sm text-muted-foreground">
                  New here?{" "}
                  <Link
                    href={authPathWithReturnTo("/register", returnTo)}
                    className="text-primary underline"
                  >
                    Create an account with email
                  </Link>
                </p>
              ) : null}
            </>
          ) : null}
          {devEnabled ? (
            <>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" aria-hidden />
                Development
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
              <Button asChild variant="ghost" className="w-full">
                <Link href={authPathWithReturnTo("/dev-login", returnTo)}>
                  Use development sign-in
                </Link>
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
