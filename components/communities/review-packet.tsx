"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { proposalStatusLabels } from "@/lib/community-standard-types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import {
  REVIEW_PACKET_TARGET_LIMIT,
  type CommunityReviewPacket
} from "@/lib/community-review-packet-types"

export function ReviewPacketButton({
  communitySlug,
  targets,
  label = "Export review packet"
}: {
  communitySlug: string
  targets: string[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState(false)
  const [examples, setExamples] = useState(false)
  const [packet, setPacket] = useState<CommunityReviewPacket | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const targetKey = JSON.stringify([...new Set(targets)].sort())
  const endpoint = `/api/communities/${encodeURIComponent(communitySlug)}/review-packet`
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const query = new URLSearchParams({
      format: "preview",
      names: names ? "1" : "0",
      examples: examples ? "1" : "0"
    })
    for (const target of JSON.parse(targetKey) as string[])
      query.append("target", target)
    void fetch(`${endpoint}?${query}`, {
      signal: controller.signal,
      cache: "no-store"
    })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok)
          throw new Error(body.error ?? "Could not prepare the review packet.")
        if (!controller.signal.aborted) setPacket(body)
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not prepare the review packet."
          )
      })
    return () => controller.abort()
  }, [open, names, examples, targetKey, endpoint, refresh])

  async function download(format: "html" | "json") {
    if (!packet || busy) return
    setBusy(true)
    setError("")
    // Open immediately, while the click retains its browser activation.
    const preview =
      format === "html" ? window.open("about:blank", "_blank") : null
    if (preview) preview.opener = null
    try {
      const query = new URLSearchParams({
        format,
        names: names ? "1" : "0",
        examples: examples ? "1" : "0",
        fingerprint: packet.fingerprint
      })
      for (const target of JSON.parse(targetKey) as string[])
        query.append("target", target)
      const response = await fetch(`${endpoint}?${query}`, {
        cache: "no-store"
      })
      if (!response.ok) {
        const body = await response.json()
        if (response.status === 409) setPacket(null)
        throw new Error(body.error ?? "Could not export the review packet.")
      }
      const url = URL.createObjectURL(await response.blob())
      if (preview) preview.location.replace(url)
      else {
        const link = document.createElement("a")
        link.href = url
        link.download = `${communitySlug}-review-packet.${format}`
        link.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      preview?.close()
      setError(
        error instanceof Error
          ? error.message
          : "Could not export the review packet."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setPacket(null)
          setError("")
          setOpen(value)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={
            !targets.length || targets.length > REVIEW_PACKET_TARGET_LIMIT
          }
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review packet</DialogTitle>
          <DialogDescription>
            Selected revisions, changes, sources and feedback. Exporting leaves
            decisions and published content unchanged.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={names}
            disabled={busy}
            onChange={(event) => {
              setPacket(null)
              setError("")
              setNames(event.target.checked)
            }}
            className="mt-1"
          />
          Include respondent names
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={examples}
            disabled={busy}
            onChange={(event) => {
              setPacket(null)
              setError("")
              setExamples(event.target.checked)
            }}
            className="mt-1"
          />
          <span>
            Include dataset examples
            <span className="block text-xs text-muted-foreground">
              Uses the examples saved with the selected feedback. Their text may
              identify contributors.
            </span>
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!packet && !error ? <p role="status">Preparing preview…</p> : null}
        {packet ? (
          <>
            <p className="text-sm text-muted-foreground">
              {packet.items.length} selected{" "}
              {packet.items.length === 1 ? "revision" : "revisions"}.{" "}
              {names
                ? "Respondent names included."
                : "Respondent names omitted."}
              {examples
                ? ` ${packet.datasetExamples.length} dataset example revisions included.`
                : ""}
            </p>
            <ul className="divide-y rounded-md border">
              {packet.items.map((item) => {
                const responseCount = item.feedback.reduce(
                  (sum, round) => sum + round.responseCount,
                  0
                )
                return (
                  <li key={item.target} className="space-y-1 p-3">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm">
                      {item.versionLabel} ·{" "}
                      {proposalStatusLabels[item.status] ??
                        (item.status === "published"
                          ? "Published"
                          : item.status === "reference"
                            ? "Reference"
                            : item.status)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.sources.length}{" "}
                      {item.sources.length === 1 ? "source" : "sources"} ·{" "}
                      {responseCount} review{" "}
                      {responseCount === 1 ? "response" : "responses"}
                    </p>
                    {item.limitations.map((text, index) => (
                      <p key={index} className="text-xs text-muted-foreground">
                        {text}
                      </p>
                    ))}
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!packet || busy}
            onClick={() => void download("html")}
          >
            Print / save PDF
          </Button>
          <Button
            variant="outline"
            disabled={!packet || busy}
            onClick={() => void download("json")}
          >
            Download JSON
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPacket(null)
              setError("")
              setRefresh((value) => value + 1)
            }}
          >
            Refresh preview
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
