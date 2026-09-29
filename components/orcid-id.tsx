import Image from "next/image"
import { getOrcidRecordUrl } from "@/lib/apis/orcid"
import { cn } from "@/lib/utils"

// The iD icon from the ORCID brand library, used unaltered. Beside a label
// that names ORCID it is decorative.
export function OrcidIcon({ size = 16 }: { size?: 16 | 18 | 24 }) {
  return (
    <Image src="/orcid-id.svg" alt="" width={size} height={size} aria-hidden />
  )
}

// ORCID asks for an authenticated iD to appear as its full URI, linked to the
// record, beside the iD icon. Omit the icon only where the icon already stands
// beside the link.
export function OrcidIdLink({
  orcidId,
  withIcon = true,
  className
}: {
  orcidId: string
  withIcon?: boolean
  className?: string
}) {
  const href = getOrcidRecordUrl(orcidId)
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline",
        className
      )}
    >
      {withIcon ? (
        <Image src="/orcid-id.svg" alt="ORCID iD" width={16} height={16} />
      ) : null}
      <span className="break-all">{href}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
