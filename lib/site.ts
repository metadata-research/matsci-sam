/*
 * The application origin: where the pages are served and where browser
 * navigation, sign-in callbacks and email links point. It is not the
 * identifier authority; see IDENTIFIER_BASE_URL below. The default is the
 * live public host.
 *
 * Override with NEXT_PUBLIC_SITE_URL for local work or a different deployment.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://ego.cci.drexel.edu"

/*
 * The identifier authority. Every published IRI -- term, definition, revision,
 * tag, collection, model, study, graph, and the application metadata
 * namespace -- is built from this value, so it is the one setting a
 * deployment fixes before anything is cited. It is separate from SITE_URL
 * because the two change for different reasons: the application moves hosts,
 * and the identifiers do not.
 *
 * Unset, identifiers are minted under the application origin, which is how a
 * workstation and a rehearsal host behave. The public host sets it to the
 * registered persistent namespace (https://w3id.org/matsci-sam) once that
 * redirect is verified, and only then. The path grammar is unchanged either
 * way; the authority replaces the origin and nothing else.
 *
 * Read only on the server. Client bundles do not receive this variable and
 * fall back to SITE_URL, so an identifier must be built in a server component
 * or a route. A page that uses no request data is prerendered at build time
 * with the value then in the environment, so a change of the variable takes
 * effect with a release, and a restart alone leaves such a page on the old
 * base. A trailing slash is removed; anything that is not an absolute
 * http(s) URL fails at startup rather than minting malformed identifiers.
 */
export const resolveIdentifierBase = (
  identifierBaseUrl: string | undefined,
  siteUrl: string
) => {
  const configured = identifierBaseUrl?.trim()
  const base = (configured || siteUrl).replace(/\/+$/, "")
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(base))
    throw new Error(
      `The identifier base must be an absolute http(s) URL; got ${JSON.stringify(
        configured || siteUrl
      )} from ${configured ? "IDENTIFIER_BASE_URL" : "NEXT_PUBLIC_SITE_URL"}`
    )
  return base
}

export const IDENTIFIER_BASE_URL = resolveIdentifierBase(
  process.env.IDENTIFIER_BASE_URL,
  SITE_URL
)

/*
 * Display name of the application -- the brand, and only the brand.
 *
 * Deliberately separate from SITE_URL and from infrastructure identifiers such
 * as the database role, systemd unit, service user, and session cookie. Those
 * are operational identity, while this value is presentation.
 *
 * Override with NEXT_PUBLIC_SITE_NAME to rebrand without a code change.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "MatSci-SAM"
