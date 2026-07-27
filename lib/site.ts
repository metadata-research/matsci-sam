/*
 * Absolute base URL. Every concept IRI is built from this, so it is not just a
 * link target -- it is the authority component of the identifiers this
 * vocabulary publishes.
 *
 * PLACEHOLDER: sam.cci.drexel.edu is the intended home pending the new VM and
 * the rename from YAMZ. Concept IRIs move with it, deliberately: the
 * identifiers change once, now, before anything is cited. Point a
 * persistent-identifier layer (w3id) at this host before external citation
 * starts, so the next move costs a redirect rule instead of every IRI.
 *
 * Override with NEXT_PUBLIC_SITE_URL for local work or a different deployment.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://sam.cci.drexel.edu"

/*
 * Display name of the application -- the brand, and only the brand.
 *
 * Deliberately separate from SITE_URL and from infrastructure identifiers such
 * as the database role, systemd unit, service user, and session cookie. Those
 * are operational identity, while this value is presentation. Changing the
 * domain would also break every published concept IRI.
 *
 * Override with NEXT_PUBLIC_SITE_NAME to rebrand without a code change.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "MatSci-SAM"
