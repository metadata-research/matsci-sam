import "server-only"

import nodemailer, { type Transporter } from "nodemailer"
import { google, type gmail_v1 } from "googleapis"
import { getAuthSiteUrl } from "@/lib/email-auth"
import { createEmailAuthLinkFragment } from "@/lib/email-auth-token"
import { SITE_NAME } from "@/lib/site"
import { invitePath } from "@/lib/public-identifiers"
import { communityInvitationMessage } from "@/lib/invitation-presentation"

type EmailMessage = {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

let smtpTransporter: Transporter | undefined
let mimeTransporter: Transporter | undefined
let gmailClient: gmail_v1.Gmail | undefined

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

const getSmtpTransporter = () => {
  if (smtpTransporter) return smtpTransporter

  const user = process.env.EMAIL_AUTH_SMTP_USER?.trim()
  const password = process.env.EMAIL_AUTH_SMTP_PASSWORD

  smtpTransporter = nodemailer.createTransport({
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

  return smtpTransporter
}

const getMimeTransporter = () => {
  if (mimeTransporter) return mimeTransporter

  mimeTransporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix"
  })

  return mimeTransporter
}

const getGmailClient = () => {
  if (gmailClient) return gmailClient

  const auth = new google.auth.OAuth2(
    requiredEmailSetting("EMAIL_AUTH_GMAIL_CLIENT_ID"),
    requiredEmailSetting("EMAIL_AUTH_GMAIL_CLIENT_SECRET")
  )
  auth.setCredentials({
    refresh_token: requiredEmailSetting("EMAIL_AUTH_GMAIL_REFRESH_TOKEN")
  })

  gmailClient = google.gmail({ version: "v1", auth })
  return gmailClient
}

const compileGmailMessage = async (message: EmailMessage) => {
  const result = (await getMimeTransporter().sendMail(message)) as {
    message?: Buffer | string
  }
  if (!result.message)
    throw new Error("Unable to compile the Gmail API message")

  const raw = Buffer.isBuffer(result.message)
    ? result.message
    : Buffer.from(result.message)
  return raw.toString("base64url")
}

const sendEmail = async (message: EmailMessage) => {
  const provider = process.env.EMAIL_AUTH_PROVIDER?.trim()

  if (provider === "gmail-api") {
    await getGmailClient().users.messages.send({
      userId: "me",
      requestBody: { raw: await compileGmailMessage(message) }
    })
    return
  }

  if (provider === "smtp") {
    await getSmtpTransporter().sendMail(message)
    return
  }

  throw new Error("EMAIL_AUTH_PROVIDER must be either gmail-api or smtp")
}

export const sendEmailSignInLink = async ({
  email,
  token,
  returnTo
}: {
  email: string
  token: string
  returnTo?: string | null
}) => {
  const url = new URL("/register/verify", getAuthSiteUrl())
  // The fragment is not sent in the browser's HTTP request or included in
  // ordinary access logs. The verification page posts it to the API.
  url.hash = createEmailAuthLinkFragment(token, returnTo)
  const htmlUrl = url.href.replaceAll("&", "&amp;")

  await sendEmail({
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
      `<p><a href="${htmlUrl}">Continue to ${SITE_NAME}</a></p>`,
      "<p>The link expires shortly and can be used only once.</p>",
      "<p>If you did not request it, you can ignore this message.</p>"
    ].join("")
  })
}

/*
 * An invitation to join a community. Sent only when the person issuing it asks
 * for it to be sent: the alternative is copying the link and delivering it by
 * hand, which is how both published studies actually ran and which sends no
 * mail to someone who has no account here.
 *
 * The token is in the path rather than the fragment, unlike the sign-in link
 * above, because the invitation page has to name the community before anyone
 * accepts. It is a lower-value secret: it admits the holder to a group, which
 * scopes what they see and nothing else. Nothing of higher value may be
 * carried this way.
 */
export const sendCommunityInvitation = async ({
  email,
  token,
  communitySlug,
  communityTitle,
  studyTitle = null
}: {
  email: string
  token: string
  communitySlug: string
  communityTitle: string
  // Set for a study invitation, whose email leads with the study rather
  // than with joining the community the recipient may already be in.
  studyTitle?: string | null
}) => {
  const url = new URL(invitePath(token), getAuthSiteUrl())
  const message = communityInvitationMessage({
    communitySlug,
    communityTitle,
    studyTitle,
    url: url.href,
    siteName: SITE_NAME
  })

  await sendEmail({
    from: requiredEmailSetting("EMAIL_AUTH_FROM"),
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html
  })
}
