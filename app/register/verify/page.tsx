import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isEmailAuthEnabled } from "@/lib/email-auth"
import { SITE_NAME } from "@/lib/site"
import { VerifyEmailLink } from "./verify-email-link"

export const metadata: Metadata = {
  title: `Verify email | ${SITE_NAME}`,
  referrer: "no-referrer"
}

export default function VerifyEmailPage() {
  if (!isEmailAuthEnabled()) notFound()
  return <VerifyEmailLink />
}
