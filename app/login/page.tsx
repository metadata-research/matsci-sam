import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
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
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = { title: `Sign in | ${SITE_NAME}` }

export default function LoginPage() {
  const devEnabled = isDevAuthEnabled()
  const emailEnabled = isEmailAuthEnabled()
  const emailAccountCreationEnabled = isEmailAccountCreationEnabled()
  const orcidEnabled = isOrcidAuthEnabled()

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">
            Sign in to {SITE_NAME}
          </CardTitle>
          <CardDescription>
            Continue with an identity already connected to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button asChild variant="outline" className="w-full">
            <a href="/api/auth/google">Continue with Google</a>
          </Button>
          {orcidEnabled ? (
            <Button asChild variant="outline" className="w-full">
              <a href="/api/auth/orcid?intent=login">
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
          ) : null}
          {emailEnabled ? (
            <>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Email
                <span className="h-px flex-1 bg-border" />
              </div>
              <form
                action="/api/auth/email/start"
                method="post"
                className="space-y-4"
              >
                <input type="hidden" name="intent" value="sign-in" />
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
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full">
                  Email me a sign-in link
                </Button>
              </form>
              {emailAccountCreationEnabled ? (
                <p className="text-center text-sm text-muted-foreground">
                  New here?{" "}
                  <Link href="/register" className="text-primary underline">
                    Create an account by email
                  </Link>
                </p>
              ) : null}
            </>
          ) : null}
          {devEnabled ? (
            <>
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Development
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button asChild variant="ghost" className="w-full">
                <Link href="/dev-login">Use development sign-in</Link>
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
