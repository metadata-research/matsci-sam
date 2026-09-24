import { DownloadIcon } from "lucide-react"
import {
  contributionFilePath,
  formatContributionFileSize,
  type ContributionFileItem
} from "@/lib/contribution-file-types"

export function ContributionFileDownloads({
  files,
  showCaption = true
}: {
  files: ContributionFileItem[]
  showCaption?: boolean
}) {
  if (!files.length) return null
  return (
    <ul className="space-y-3" aria-label="Published files">
      {files.map((file) => (
        <li key={file.id} className="space-y-1 rounded-lg border p-3 text-sm">
          <a
            className="inline-flex items-center gap-2 font-medium underline"
            href={contributionFilePath(file.id)}
          >
            <DownloadIcon aria-hidden className="size-4 shrink-0" />
            <span>{file.title}</span>
          </a>
          <p className="break-words text-xs text-muted-foreground">
            {file.role === "source" ? "Source" : "Example"} · {file.filename} ·{" "}
            {formatContributionFileSize(file.byteSize)}
          </p>
          {showCaption ? (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {file.caption}
            </p>
          ) : null}
          {file.citation ? <p>{file.citation}</p> : null}
          {file.page ? <p>Page or section: {file.page}</p> : null}
        </li>
      ))}
    </ul>
  )
}
