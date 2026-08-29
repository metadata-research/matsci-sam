import type { InvitationOutcome } from "@/lib/communities"

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
  if (displayName && email && email.toLowerCase() !== intendedEmail.toLowerCase())
    return `${displayName} (${email})`
  return displayName ?? email ?? "a signed-in participant"
}
