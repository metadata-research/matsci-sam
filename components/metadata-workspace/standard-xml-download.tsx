"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog"
import { WorkspaceSelect } from "./workspace-select"

type Props = {
  vocabularySlug: string
  mode: "reference" | "working" | "release"
  versionLabel: string
  referenceReleaseId?: string
  releaseId?: string
  fingerprint: string
  profile?: string
  sections: { id: string; label: string }[]
}

export function StandardXmlDownload(props: Props) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  async function download() {
    if (inFlight.current || !profile) return
    inFlight.current = true
    setBusy(true)
    setError("")
    try {
      const query = new URLSearchParams({
        vocabularySlug: props.vocabularySlug,
        mode: props.mode,
        profile
      })
      if (props.referenceReleaseId)
        query.set("referenceReleaseId", props.referenceReleaseId)
      if (props.mode === "release" && props.releaseId)
        query.set("releaseId", props.releaseId)
      if (props.mode === "working")
        query.set("expectedFingerprint", props.fingerprint)
      const response = await fetch(`/api/metadata/template?${query}`, {
        cache: "no-store"
      })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "metadata-template.xml"
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Give browsers time to consume the download before releasing the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setOpen(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The template could not be downloaded. Try again."
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value)
      }}
    >
      <Button
        variant="outline"
        disabled={!props.sections.length}
        onClick={() => {
          setProfile(
            props.profile ??
              (props.sections.length === 1 ? props.sections[0].id : "")
          )
          setError("")
          setOpen(true)
        }}
      >
        Download XML template
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download XML template</DialogTitle>
          <DialogDescription>
            {props.versionLabel}. Includes every field in the selected section.
            Download other sections separately.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="xml-template-section">Section</FieldLabel>
          <WorkspaceSelect
            id="xml-template-section"
            value={profile}
            disabled={busy}
            onChange={(event) => setProfile(event.target.value)}
          >
            <option value="">Choose a section</option>
            {props.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button disabled={busy || !profile} onClick={download}>
            {busy ? "Preparing download…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
