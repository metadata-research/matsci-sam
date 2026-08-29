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
  if (name && email && email.toLowerCase() !== intendedEmail.toLowerCase())
    return `${name} (${email})`
  return name ?? email ?? "a signed-in participant"
}
