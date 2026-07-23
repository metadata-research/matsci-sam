import "server-only"

import nodemailer, { type Transporter } from "nodemailer"
import { getAuthSiteUrl } from "@/lib/email-auth"
import { SITE_NAME } from "@/lib/site"

let transporter: Transporter | undefined

const requiredEmailSetting = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for email authentication`)
  return value
}

const smtpPort = () => {
  const value = Number(process.env.EMAIL_AUTH_SMTP_PORT?.trim() || "587")
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error("EMAIL_AUTH_SMTP_PORT must be a valid port")
  return value
}

const getTransporter = () => {
  if (transporter) return transporter

  const user = process.env.EMAIL_AUTH_SMTP_USER?.trim()
  const password = process.env.EMAIL_AUTH_SMTP_PASSWORD

  transporter = nodemailer.createTransport({
    host: requiredEmailSetting("EMAIL_AUTH_SMTP_HOST"),
    port: smtpPort(),
    secure: process.env.EMAIL_AUTH_SMTP_SECURE === "true",
    auth: user
      ? {
          user,
          pass: password || requiredEmailSetting("EMAIL_AUTH_SMTP_PASSWORD")
        }
      : undefined
  })

  return transporter
}

export const sendEmailSignInLink = async ({
  email,
  token
}: {
  email: string
  token: string
}) => {
  const url = new URL("/register/verify", getAuthSiteUrl())
  // The fragment is not sent in the browser's HTTP request or included in
  // ordinary access logs. The verification page posts it to the API.
  url.hash = new URLSearchParams({ token }).toString()

  await getTransporter().sendMail({
    from: requiredEmailSetting("EMAIL_AUTH_FROM"),
    to: email,
    subject: `Sign in to ${SITE_NAME}`,
    text: [
      `Use this one-time link to sign in to ${SITE_NAME}:`,
      "",
      url.href,
      "",
      "The link expires shortly and can be used only once.",
      "If you did not request it, you can ignore this message."
    ].join("\n"),
    html: [
      `<p>Use this one-time link to sign in to ${SITE_NAME}:</p>`,
      `<p><a href="${url.href}">Continue to ${SITE_NAME}</a></p>`,
      "<p>The link expires shortly and can be used only once.</p>",
      "<p>If you did not request it, you can ignore this message.</p>"
    ].join("")
  })
}
