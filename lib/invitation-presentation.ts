import type { InvitationOutcome } from "@/lib/communities"

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const COMMUNITY_INVITATION_NAMES: Record<string, string> = {
  id4: "NSF Institute for Data-Driven Dynamical Design (ID4)"
}

const vocabularyCommunityLabel = ({
  communitySlug,
  communityTitle
}: {
  communitySlug: string
  communityTitle: string
}) => {
  const name = COMMUNITY_INVITATION_NAMES[communitySlug] ?? communityTitle
  if (/vocabulary community$/i.test(name)) return name
  if (/community$/i.test(name))
    return `${name.replace(/ community$/i, "")} Vocabulary Community`
  return `${name} Vocabulary Community`
}

export const communityInvitationPageCopy = ({
  communitySlug,
  communityTitle,
  siteName,
  alreadyIn
}: {
  communitySlug: string
  communityTitle: string
  siteName: string
  alreadyIn: boolean
}) => {
  const communityLabel = vocabularyCommunityLabel({
    communitySlug,
    communityTitle
  })

  return alreadyIn
    ? {
        title: communityTitle,
        description: `You are already a member of the ${communityLabel}.`
      }
    : {
        title: `Join ${communityTitle}`,
        description: `You have been invited to join the ${communityLabel} on ${siteName}.`
      }
}

/*
 * The invitation email, built as a pure function so the wording is testable.
 * A study invitation leads with the study: the recipient may already be in
 * the community, and the invite page routes an existing member straight to
 * the study, so the community appears as the asker and not as the thing
 * being joined. A community invitation keeps the join wording.
 */
export const communityInvitationMessage = ({
  communitySlug,
  communityTitle,
  studyTitle,
  url,
  siteName
}: {
  communitySlug: string
  communityTitle: string
  studyTitle: string | null
  url: string
  siteName: string
}) => {
  const communityLabel = vocabularyCommunityLabel({
    communitySlug,
    communityTitle
  })
  const invitationLine = studyTitle
    ? `${communityTitle} has asked you to take part in the study ${studyTitle} on ${siteName}.`
    : `You have been invited to join the ${communityLabel} on ${siteName}.`
  const membershipNote = studyTitle
    ? `Accepting opens the study. It also joins you to ${communityTitle} if you are not already in it.`
    : null

  return {
    subject: studyTitle
      ? `You have been asked to take part in ${studyTitle}`
      : `Invitation to join the ${communityLabel}`,
    text: [
      invitationLine,
      "",
      url,
      "",
      "Open the link and sign in, then choose whether to accept.",
      "If you do not have an account yet, you can create one first and then",
      "return to this link.",
      ...(membershipNote ? ["", membershipNote] : []),
      "",
      "If you were not expecting this, you can ignore this message."
    ].join("\n"),
    html: [
      `<p>${escapeHtml(invitationLine)}</p>`,
      `<p><a href="${url}">Open the invitation</a></p>`,
      "<p>Open the link and sign in, then choose whether to accept. If you do not have an account yet, you can create one first and then return to this link.</p>",
      ...(membershipNote ? [`<p>${escapeHtml(membershipNote)}</p>`] : []),
      "<p>If you were not expecting this, you can ignore this message.</p>"
    ].join("")
  }
}

const OUTCOME_LABEL: Record<InvitationOutcome, string> = {
  live: "Pending",
  redeemed: "Accepted",
  expired: "Expired",
  revoked: "Revoked"
}

export const invitationOutcomeLabel = (outcome: InvitationOutcome) =>
  OUTCOME_LABEL[outcome]

export const invitationRedeemedByLabel = ({
  intendedEmail,
  name,
  email
}: {
  intendedEmail: string
  name: string | null
  email: string | null
}) => {
  // Email and Google signups create accounts whose name is an empty string
  // until a profile is saved, so blank means absent here — the label falls
  // to the address, which also keeps a mismatched address visible.
  const displayName = name?.trim() || null
  if (
    displayName &&
    email &&
    email.toLowerCase() !== intendedEmail.toLowerCase()
  )
    return `${displayName} (${email})`
  return displayName ?? email ?? "a signed-in participant"
}
