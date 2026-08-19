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
import { isEmailAuthEnabled } from "@/lib/email-auth"
import { SITE_NAME } from "@/lib/site"

export const metadata: Metadata = { title: `Check your email | ${SITE_NAME}` }

export default function CheckEmailPage() {
  if (!isEmailAuthEnabled()) notFound()

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MailCheckIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="text-2xl">
            Check your email
          </CardTitle>
          <CardDescription className="leading-6">
            If the address can receive mail, a one-time sign-in link is on its
            way. The link expires shortly and works only once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Return home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
