import assert from "node:assert/strict"
import {
  invitationExpiry,
  invitationOutcome,
  mayManageCommunity,
  mayRunCommunity,
  maySearchPeople,
  maySetCommunityMember,
  maySetCommunityRole,
  mayViewRoster,
  type Membership,
  type Viewer
} from "../lib/communities"

// Every rule is asserted in both directions. A rule checked only where it
// refuses can pass while permitting nothing at all.

const admin: Viewer = { id: 1, role: "admin" }
const steward: Viewer = { id: 2, role: "user" }
const member: Viewer = { id: 3, role: "user" }
const outsider: Viewer = { id: 4, role: "user" }
const anonymous: Viewer = null

const asSteward: Membership = { role: "steward" }
const asMember: Membership = { role: "member" }
const notIn: Membership = null

const targetMember = (userId: number) => ({ userId, role: "member" as const })
const targetSteward = (userId: number) => ({ userId, role: "steward" as const })
const targetStranger = (userId: number) => ({ userId, role: null })

// --- The community record belongs to an administrator ---

assert.equal(mayManageCommunity(admin), true)
assert.equal(mayManageCommunity(steward), false)
assert.equal(mayManageCommunity(member), false)
assert.equal(mayManageCommunity(anonymous), false)

assert.equal(maySetCommunityRole(admin), true)
assert.equal(maySetCommunityRole(steward), false)
assert.equal(maySetCommunityRole(anonymous), false)

// --- The roster belongs to a steward ---

// An administrator acts on any community, member of it or not.
assert.equal(
  maySetCommunityMember(admin, notIn, targetStranger(9), true),
  true
)
assert.equal(
  maySetCommunityMember(admin, notIn, targetSteward(2), false),
  true
)

// A steward adds anyone and removes plain members.
assert.equal(
  maySetCommunityMember(steward, asSteward, targetStranger(9), true),
  true
)
assert.equal(
  maySetCommunityMember(steward, asSteward, targetMember(3), false),
  true
)

// A steward may not unmake another steward. Only an administrator names one.
assert.equal(
  maySetCommunityMember(steward, asSteward, targetSteward(5), false),
  false
)

// A steward may still leave of their own accord.
assert.equal(
  maySetCommunityMember(steward, asSteward, targetSteward(2), false),
  true
)

// A plain member may leave, and may do nothing else.
assert.equal(
  maySetCommunityMember(member, asMember, targetMember(3), false),
  true
)
assert.equal(
  maySetCommunityMember(member, asMember, targetMember(3), true),
  false,
  "a member rejoining themselves is not a member's call"
)
assert.equal(
  maySetCommunityMember(member, asMember, targetStranger(9), true),
  false
)
assert.equal(
  maySetCommunityMember(member, asMember, targetMember(5), false),
  false
)

// Someone outside the community, and someone signed out, may do nothing.
assert.equal(
  maySetCommunityMember(outsider, notIn, targetStranger(9), true),
  false
)
assert.equal(
  maySetCommunityMember(outsider, notIn, targetMember(3), false),
  false
)
assert.equal(
  maySetCommunityMember(anonymous, notIn, targetStranger(9), true),
  false
)
assert.equal(
  maySetCommunityMember(anonymous, notIn, targetStranger(4), false),
  false,
  "self-removal must not be reachable without a viewer"
)

// A steward of one community has no standing in another, where they are not a
// member and carry no membership row.
assert.equal(
  maySetCommunityMember(steward, notIn, targetStranger(9), true),
  false
)

// --- The worklist, invitations and the join link belong to a steward ---

assert.equal(mayRunCommunity(admin, notIn), true)
assert.equal(mayRunCommunity(steward, asSteward), true)
assert.equal(mayRunCommunity(member, asMember), false)
assert.equal(mayRunCommunity(steward, notIn), false)
assert.equal(mayRunCommunity(anonymous, notIn), false)

// --- Looking someone up is gated to whoever can act on the result ---

assert.equal(maySearchPeople(admin, notIn), true)
assert.equal(maySearchPeople(steward, asSteward), true)
assert.equal(maySearchPeople(member, asMember), false)
assert.equal(maySearchPeople(outsider, notIn), false)
assert.equal(maySearchPeople(anonymous, notIn), false)

// --- The roster is visible to the people in it ---

assert.equal(mayViewRoster(admin, notIn), true)
assert.equal(mayViewRoster(steward, asSteward), true)
assert.equal(mayViewRoster(member, asMember), true)
assert.equal(mayViewRoster(outsider, notIn), false)
assert.equal(mayViewRoster(anonymous, notIn), false)
assert.equal(
  mayViewRoster(anonymous, asMember),
  false,
  "a membership without a viewer is not a viewer"
)

// --- An invitation ends once, and one way ---

const live = {
  revokedAt: null,
  redeemedAt: null,
  expiresAt: "2026-09-01T00:00:00Z"
}
const before = new Date("2026-08-21T00:00:00Z")
const after = new Date("2026-09-02T00:00:00Z")

assert.equal(invitationOutcome(live, before), "live")
assert.equal(invitationOutcome(live, after), "expired")
assert.equal(
  invitationOutcome({ ...live, expiresAt: "2026-08-21T00:00:00Z" }, before),
  "expired",
  "expiry is exclusive at the boundary"
)
assert.equal(
  invitationOutcome({ ...live, revokedAt: "2026-08-20T00:00:00Z" }, before),
  "revoked"
)
assert.equal(
  invitationOutcome({ ...live, redeemedAt: "2026-08-20T00:00:00Z" }, before),
  "redeemed"
)
assert.equal(
  invitationOutcome({ ...live, redeemedAt: "2026-08-20T00:00:00Z" }, after),
  "redeemed",
  "a redeemed invitation does not lapse into expired: the person is in"
)
assert.equal(
  invitationOutcome({ ...live, revokedAt: "2026-08-20T00:00:00Z" }, after),
  "revoked"
)

const issued = invitationExpiry(Date.parse("2026-08-21T00:00:00Z"))
assert.equal(issued.toISOString(), "2026-09-04T00:00:00.000Z")
assert.equal(
  invitationOutcome(
    { revokedAt: null, redeemedAt: null, expiresAt: issued.toISOString() },
    new Date("2026-09-03T00:00:00Z")
  ),
  "live"
)

console.log("Community rule tests passed")
