import Link from "next/link"
import type { ComponentProps } from "react"

/** Enter private editors with a fresh document. Client navigation can finish
 * with an empty route after a prefetched, fragment-linked workspace visit.
 * This boundary avoids that reproduced failure without changing draft guards.
 */
export function FieldDestinationLink({
  href,
  ...props
}: ComponentProps<"a"> & { href: string }) {
  return href.startsWith("/metadata/workspace/") ? (
    <a href={href} {...props} />
  ) : (
    <Link href={href} {...props} />
  )
}
