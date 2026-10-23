import Link from "next/link"
import type { ComponentProps } from "react"
import { normalizeCommunityWorkReturnTo } from "@/lib/community-work-return"
import { normalizeMatcoreCatalogReturnTo } from "@/lib/matcore-catalog-navigation"

/** Next's cached canonical URL can already contain an initial fragment.
 * Use document navigation for these returns so it cannot append it twice.
 * Draft guards still intercept dirty clicks and flush before following.
 */
export function CommunityWorkReturnLink({
  href,
  ...props
}: ComponentProps<"a"> & {
  href: string
  "data-draft-navigation"?: "handled" | "document"
}) {
  return normalizeCommunityWorkReturnTo(href) ||
    normalizeMatcoreCatalogReturnTo(href) ? (
    <a href={href} data-draft-navigation="document" {...props} />
  ) : (
    <Link href={href} {...props} />
  )
}
