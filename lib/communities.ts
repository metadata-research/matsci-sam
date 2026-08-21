/*
 * Who may do what to a community. Pure rules, so the pages, the router and the
 * tests all load the same functions and there is one answer to each question.
 *
 * The division: an administrator owns the community record, and a steward runs
 * what happens inside it. An administrator creates a community, renames it,
 * retires it, and names its stewards. A steward manages the roster and the
 * worklist of the one community they steward, and nothing else. That is why
 * there is no assertableBy column here. On a collection the policy varies per
 * row. Here the policy is the same everywhere, and the variation is which
 * community a person stewards.
 *
 * Every rule takes the viewer's membership of the community in question rather
 * than looking it up, so none of this touches the database.
 */

export type CommunityRole = "member" | "steward"

export type Viewer = { id: number; role: string } | null

// The viewer's live membership of the community being acted on, or null when
// they are not in it. A closed episode is not a membership.
export type Membership = { role: CommunityRole } | null

const isSiteAdmin = (viewer: Viewer) => viewer?.role === "admin"

const isSteward = (viewer: Viewer, membership: Membership) =>
  viewer !== null && membership?.role === "steward"

/*
 * Create a community, rename it, retire it, restore it. Administrator only.
 * Which communities exist is a site-level decision, and a retired community is
 * an address that must keep resolving, so neither is a steward's to make.
 */
export const mayManageCommunity = (viewer: Viewer) => isSiteAdmin(viewer)

/*
 * Name a steward, or take the role back. Administrator only, because a steward
 * who could appoint stewards could hand out roster control indefinitely.
 */
export const maySetCommunityRole = (viewer: Viewer) => isSiteAdmin(viewer)

/*
 * Add or remove one person. A steward runs their own roster, and anyone may
 * leave. The one thing a steward may not do is remove another steward: only an
 * administrator names a steward, so only an administrator unmakes one. A
 * steward leaving of their own accord is allowed, and leaves the community
 * without one until an administrator names another.
 */
export const maySetCommunityMember = (
  viewer: Viewer,
  membership: Membership,
  target: { userId: number; role: CommunityRole | null },
  on: boolean
) => {
  if (!viewer) return false
  if (isSiteAdmin(viewer)) return true
  // Leaving must never be refusable, whatever else is true.
  if (!on && target.userId === viewer.id) return true
  if (!isSteward(viewer, membership)) return false
  return on || target.role !== "steward"
}

/*
 * Running the community from day to day: what it is working through, who is
 * invited, and whether it has an open join link. One rule rather than three
 * synonyms, because a steward who can set the worklist can invite and a
 * steward who can invite can set the worklist. The collections themselves stay
 * under mayAssertIn, and the roster has its own rule above because leaving is
 * a case this one does not cover.
 */
export const mayRunCommunity = (viewer: Viewer, membership: Membership) =>
  isSiteAdmin(viewer) || isSteward(viewer, membership)

/*
 * Look someone up in order to add them. Gated to the people who can act on the
 * result, because it is the only path by which a non-administrator reads
 * anything about accounts other than their own. It returns names, never email
 * addresses, and affiliation only for a profile its owner made public.
 */
export const maySearchPeople = (viewer: Viewer, membership: Membership) =>
  isSiteAdmin(viewer) || isSteward(viewer, membership)

/*
 * See who is in a community. Members and administrators only, with a count for
 * everyone else. isProfilePublic defaults false and a private profile renders
 * as plain text rather than a link, so a public roster would publish "these
 * named people are in this lab" for people who declined a public profile. A
 * contributor name is attached to work someone did. A group someone belongs to
 * is not their work.
 */
export const mayViewRoster = (viewer: Viewer, membership: Membership) => {
  if (!viewer) return false
  return isSiteAdmin(viewer) || membership !== null
}

/*
 * How long a per-person invitation lives. Fourteen days covers the two-week
 * task window the ID4 study ran in, and a lapsed invitation is reissued rather
 * than extended, so nothing depends on getting this exactly right.
 */
export const INVITATION_LIFETIME_DAYS = 14

export const invitationExpiry = (now = Date.now()) =>
  new Date(now + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000)

export type InvitationOutcome = "live" | "revoked" | "redeemed" | "expired"

/*
 * What has become of an invitation. An invitation ends once and one way, so
 * the order here is the order of finality: a redeemed invitation that has
 * since passed its expiry reads as redeemed, because the person is in.
 */
export const invitationOutcome = (
  invitation: {
    revokedAt: string | null
    redeemedAt: string | null
    expiresAt: string
  },
  now: Date = new Date()
): InvitationOutcome => {
  if (invitation.revokedAt) return "revoked"
  if (invitation.redeemedAt) return "redeemed"
  if (new Date(invitation.expiresAt) <= now) return "expired"
  return "live"
}

/*
 * A study joins one community to one collection and says what its participants
 * are being asked to do. Creating and editing one is running the community, so
 * it takes the same rule as the worklist and the invitations rather than a new
 * one: a steward decides what their own community is working on, and a study
 * is that decision with instructions attached.
 */
export const mayRunStudy = mayRunCommunity

export type StudyState = "draft" | "open" | "closed" | "retired"

/*
 * Where a study stands. Both dates are optional, so a study with neither is
 * open from the moment it exists, which is the ordinary case for a cohort that
 * is told when to start by email.
 */
export const studyState = (
  study: {
    opensAt: string | null
    closesAt: string | null
    retiredAt: string | null
  },
  now: Date = new Date()
): StudyState => {
  if (study.retiredAt) return "retired"
  if (study.opensAt && new Date(study.opensAt) > now) return "draft"
  if (study.closesAt && new Date(study.closesAt) <= now) return "closed"
  return "open"
}

// An invitation to a study stops being acceptable once the study is over. The
// community invitation is unaffected, because belonging to a lab outlives any
// one piece of work it did.
export const studyAcceptsParticipants = (
  study: Parameters<typeof studyState>[0],
  now: Date = new Date()
) => {
  const state = studyState(study, now)
  return state === "draft" || state === "open"
}
