"use client"

import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from "react"
import { PaperclipIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  SourceDocumentContext,
  type SourceContextPreview
} from "./source-document-context"
import type {
  SourceContextSelection,
  SourceInputSnapshot
} from "@/lib/source-document-types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import {
  CONTRIBUTION_FILE_MAX_BYTES,
  CONTRIBUTION_FILE_MAX_COUNT,
  contributionFileMetadataSchema,
  contributionFilePath,
  formatContributionFileSize,
  type PendingContributionFile,
  type ContributionFileItem,
  type ContributionFilePublication
} from "@/lib/contribution-file-types"

export type DraftContributionFile = ContributionFileItem & { publish: boolean }
export const selectedFilePublications = (
  files: DraftContributionFile[]
): ContributionFilePublication[] =>
  files
    .filter((file) => file.publish)
    .map((file) => ({ fileId: file.id, publish: true }))

type Props = {
  files: DraftContributionFile[]
  onFilesChange: (files: DraftContributionFile[]) => void
  term: string
  vocabularySlug: string
  draftId?: string
  explicitVocabulary?: boolean
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  inline?: boolean
  sources?: SourceContextSelection[]
  onSourcesChange?: (sources: SourceContextSelection[]) => void
  onSourcePreview?: (preview: SourceContextPreview) => void
  assistantSourceInputs?: SourceInputSnapshot[]
  contextLimit?: number
}

export function ContributionFiles(props: Props) {
  const [open, setOpen] = useState(false)
  if (props.inline) return <ContributionFileFields {...props} />
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={props.disabled}>
          <PaperclipIcon aria-hidden />
          Add file or text
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add file or text</DialogTitle>
          <DialogDescription>
            Upload a document, paste source text, or attach an image example.
          </DialogDescription>
        </DialogHeader>
        <ContributionFileFields {...props} />
      </DialogContent>
    </Dialog>
  )
}

export function ContributionFileFields({
  files,
  onFilesChange,
  term,
  vocabularySlug,
  draftId,
  explicitVocabulary = false,
  disabled,
  onBusyChange,
  sources = [],
  onSourcesChange,
  onSourcePreview,
  assistantSourceInputs = [],
  contextLimit
}: Props) {
  const id = useId()
  const [file, setFile] = useState<File | null>(null)
  const [role, setRole] = useState<"example" | "source">("source")
  const [origin, setOrigin] = useState<"upload" | "paste">("upload")
  const [pastedText, setPastedText] = useState("")
  const [title, setTitle] = useState("")
  const [caption, setCaption] = useState("")
  const [citation, setCitation] = useState("")
  const [page, setPage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingContributionFile[]>([])
  const attachedCount = new Set([
    ...files.map((item) => item.id),
    ...assistantSourceInputs.map((item) => item.fileId)
  ]).size
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const scope = `${term}\n${vocabularySlug}`
  const currentScope = useRef(scope)
  const changeBusy = useRef(onBusyChange)
  useLayoutEffect(() => {
    currentScope.current = scope
    changeBusy.current = onBusyChange
  }, [scope, onBusyChange])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      changeBusy.current?.(false)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/contribution-files", {
      credentials: "same-origin",
      signal: controller.signal
    })
      .then(async (response) => {
        if (response.ok) return response.json()
        return []
      })
      .then((items) => {
        if (!controller.signal.aborted) setPending(items)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  const begin = () => {
    setBusy(true)
    onBusyChange?.(true)
    setError("")
  }
  const end = () => {
    if (mounted.current) setBusy(false)
    changeBusy.current?.(false)
  }
  const upload = async () => {
    if (disabled || busy) return
    const selectedFile =
      origin === "paste"
        ? new File([pastedText], "pasted-source.txt", { type: "text/plain" })
        : file
    if (!selectedFile) return
    if (selectedFile.size > CONTRIBUTION_FILE_MAX_BYTES || !selectedFile.size) {
      setError("Choose a file between 1 byte and 5 MB.")
      return
    }
    if (attachedCount >= CONTRIBUTION_FILE_MAX_COUNT) {
      setError("You can attach up to three files.")
      return
    }
    const metadata = contributionFileMetadataSchema.safeParse({
      term,
      vocabularySlug,
      draftId,
      explicitVocabulary,
      filename: selectedFile.name,
      origin,
      role: origin === "paste" ? "source" : role,
      title,
      caption:
        caption.trim() ||
        (origin === "paste" ? `Source text for ${term}.` : ""),
      citation: role === "source" ? citation : undefined,
      page: role === "source" ? page : undefined
    })
    if (!metadata.success) {
      setError(metadata.error.issues[0].message)
      return
    }
    begin()
    try {
      const upload = new FormData()
      upload.set("file", selectedFile)
      upload.set("metadata", JSON.stringify(metadata.data))
      const response = await fetch("/api/contribution-files", {
        method: "POST",
        credentials: "same-origin",
        body: upload
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || "The file could not be saved.")
      if (!mounted.current || currentScope.current !== scope) {
        await fetch(contributionFilePath(result.id), {
          method: "DELETE",
          credentials: "same-origin"
        })
        return
      }
      onFilesChange([...files, { ...result, publish: false }])
      setPending((current) => [
        ...current,
        { ...result, term: term.trim().toLowerCase(), vocabularySlug }
      ])
      setFile(null)
      setPastedText("")
      setTitle("")
      setCaption("")
      setCitation("")
      setPage("")
      if (fileInput.current) fileInput.current.value = ""
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The file could not be saved."
        )
    } finally {
      end()
    }
  }
  const remove = async (item: ContributionFileItem) => {
    if (assistantSourceInputs.some((source) => source.fileId === item.id))
      return
    begin()
    try {
      const response = await fetch(contributionFilePath(item.id), {
        method: "DELETE",
        credentials: "same-origin"
      })
      if (!response.ok && response.status !== 404)
        throw new Error("The file could not be removed. Please try again.")
      if (mounted.current && currentScope.current === scope) {
        onFilesChange(files.filter((entry) => entry.id !== item.id))
        onSourcesChange?.(sources.filter((entry) => entry.fileId !== item.id))
        setPending((current) => current.filter((entry) => entry.id !== item.id))
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The file could not be removed."
        )
    } finally {
      end()
    }
  }
  // These inputs belong to an auxiliary tool inside the definition form.
  // Enter must not submit that outer form. Buttons and the native file picker
  // retain their usual keyboard behavior, and multiline captions keep Enter.
  const preventDefinitionSubmit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing)
      event.preventDefault()
  }
  const blocked = disabled || busy
  const recoverable = pending.filter(
    (item) => !files.some((file) => file.id === item.id)
  )
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        PDF, DOCX, TXT, or pasted text for sources; PNG and JPEG for examples.
        Up to 5 MB each, three items per contribution. Published sources are
        readable by readers of the definition.
      </p>
      {files.length > 0 ? (
        <ul className="space-y-2" aria-label="Attached files">
          {files.map((item) => (
            <li key={item.id} className="min-w-0 rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    className="break-words font-medium underline"
                    href={contributionFilePath(item.id)}
                  >
                    {item.title}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {item.role === "example" ? "Example" : "Source"} ·{" "}
                    {formatContributionFileSize(item.byteSize)} ·{" "}
                    {item.publish
                      ? "Selected for publication"
                      : "Private draft"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={
                    blocked ||
                    assistantSourceInputs.some(
                      (source) => source.fileId === item.id
                    )
                  }
                  aria-label={`Remove file: ${item.title}`}
                  onClick={() => void remove(item)}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
              {assistantSourceInputs.some(
                (source) => source.fileId === item.id
              ) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Used by assistant. Discard the applied suggestion before
                  removing this source.
                </p>
              ) : null}
              {item.role === "source" && onSourcesChange && onSourcePreview ? (
                <SourceDocumentContext
                  file={item}
                  term={term}
                  selection={sources.find(
                    (source) => source.fileId === item.id
                  )}
                  onSelectionChange={(selection) =>
                    onSourcesChange([
                      ...sources.filter((source) => source.fileId !== item.id),
                      ...(selection ? [selection] : [])
                    ])
                  }
                  onPreviewChange={onSourcePreview}
                  disabled={blocked || assistantSourceInputs.length > 0}
                  contextLimit={contextLimit}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {recoverable.length ? (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Other pending files ({recoverable.length})
          </summary>
          <p className="my-2 text-xs text-muted-foreground">
            Recover an upload for this term or remove one you no longer need.
          </p>
          <ul className="space-y-3">
            {recoverable.map((item) => (
              <li key={item.id} className="space-y-1">
                <a
                  className="break-words underline"
                  href={contributionFilePath(item.id)}
                >
                  {item.title}
                </a>
                <p className="text-xs text-muted-foreground">
                  {item.term} · {formatContributionFileSize(item.byteSize)} ·
                  Private
                </p>
                <div className="flex flex-wrap gap-2">
                  {item.term === term.trim().toLowerCase() &&
                  item.vocabularySlug === vocabularySlug ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        blocked || attachedCount >= CONTRIBUTION_FILE_MAX_COUNT
                      }
                      onClick={() =>
                        onFilesChange([...files, { ...item, publish: false }])
                      }
                    >
                      Use in this draft
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={blocked}
                    onClick={() => void remove(item)}
                  >
                    Remove pending file
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {attachedCount < CONTRIBUTION_FILE_MAX_COUNT ? (
        <fieldset disabled={blocked} className="space-y-3">
          <Tabs
            value={origin}
            onValueChange={(value) => {
              setOrigin(value as "upload" | "paste")
              if (value === "paste") setRole("source")
            }}
          >
            <TabsList aria-label="Add source method">
              <TabsTrigger value="upload" disabled={blocked}>
                Upload file
              </TabsTrigger>
              <TabsTrigger value="paste" disabled={blocked}>
                Paste text
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="upload"
              forceMount
              hidden={origin !== "upload"}
              className="space-y-1"
            >
              <label htmlFor={`${id}-file`} className="text-sm font-medium">
                Choose a file
              </label>
              <Input
                ref={fileInput}
                id={`${id}-file`}
                type="file"
                accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,.pdf,.docx,.txt,.png,.jpg,.jpeg"
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null
                  setFile(chosen)
                  if (chosen?.type.startsWith("image/")) setRole("example")
                  else setRole("source")
                  if (chosen && !title)
                    setTitle(chosen.name.replace(/\.[^.]+$/, ""))
                  setError("")
                }}
              />
            </TabsContent>
            <TabsContent
              value="paste"
              forceMount
              hidden={origin !== "paste"}
              className="space-y-1"
            >
              <label htmlFor={`${id}-paste`} className="text-sm font-medium">
                Source text
              </label>
              <Textarea
                id={`${id}-paste`}
                value={pastedText}
                rows={8}
                maxLength={200000}
                onChange={(event) => setPastedText(event.target.value)}
                placeholder="Paste the text you want to use as a source."
              />
            </TabsContent>
          </Tabs>
          <div className="space-y-1" hidden={origin === "paste"}>
            <label htmlFor={`${id}-role`} className="text-sm font-medium">
              Use as
            </label>
            <select
              id={`${id}-role`}
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as "example" | "source")
              }
            >
              <option value="example">Example: illustrates the meaning</option>
              <option
                value="source"
                disabled={!!file?.type.startsWith("image/")}
              >
                Source: supports the definition
              </option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-title`} className="text-sm font-medium">
              Title
            </label>
            <Input
              id={`${id}-title`}
              onKeyDown={preventDefinitionSubmit}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-caption`} className="text-sm font-medium">
              How does it relate to this term?
              {origin === "paste" ? " (optional)" : ""}
            </label>
            <Textarea
              id={`${id}-caption`}
              value={caption}
              maxLength={2000}
              rows={2}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Describe what this file shows or supports."
            />
          </div>
          {role === "source" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor={`${id}-citation`}
                  className="text-sm font-medium"
                >
                  Citation (optional)
                </label>
                <Input
                  id={`${id}-citation`}
                  onKeyDown={preventDefinitionSubmit}
                  value={citation}
                  maxLength={1000}
                  onChange={(event) => setCitation(event.target.value)}
                  placeholder="Author, title, year, DOI or URL"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-page`} className="text-sm font-medium">
                  Page or section (optional)
                </label>
                <Input
                  id={`${id}-page`}
                  onKeyDown={preventDefinitionSubmit}
                  value={page}
                  maxLength={100}
                  onChange={(event) => setPage(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={
              (origin === "paste" ? !pastedText.trim() : !file) ||
              !title.trim() ||
              (origin === "upload" && !caption.trim()) ||
              blocked
            }
            onClick={() => void upload()}
          >
            {busy
              ? "Saving file…"
              : role === "source"
                ? "Attach source"
                : "Attach example"}
          </Button>
        </fieldset>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Adding a source does not contact an assistant. Only checked, selected
        text is sent when you request a suggestion. Unpublished sources outside
        a saved draft expire after 24 hours.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function ContributionFilesReview({
  files,
  onFilesChange,
  disabled,
  assistantSourceInputs = []
}: Pick<
  Props,
  "files" | "onFilesChange" | "disabled" | "assistantSourceInputs"
>) {
  const id = useId()
  if (!files.length && !assistantSourceInputs.length) return null
  const additionalSources = assistantSourceInputs.filter(
    (source) => !files.some((file) => file.id === source.fileId)
  )
  return (
    <section aria-label="Review attached files" className="space-y-3">
      <p className="font-medium">Files and text to publish</p>
      {additionalSources.map((source) => (
        <div
          key={source.fileId}
          className="space-y-2 rounded-lg border p-3 text-sm"
        >
          <p className="font-medium">{source.title}</p>
          <p>Used by assistant · included with this definition</p>
          <a className="underline" href={contributionFilePath(source.fileId)}>
            Read source
          </a>
        </div>
      ))}
      <p className="text-sm text-muted-foreground">
        Select the sources you cite and the examples you want readers to see.
        Sources used by an applied assistant suggestion are included with that
        suggestion, even when you do not separately cite them.
      </p>
      {files.map((file) => (
        <div key={file.id} className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex items-start gap-2">
            <input
              id={`${id}-${file.id}`}
              type="checkbox"
              checked={file.publish}
              disabled={disabled}
              onChange={(event) =>
                onFilesChange(
                  files.map((entry) =>
                    entry.id === file.id
                      ? { ...entry, publish: event.target.checked }
                      : entry
                  )
                )
              }
              className="mt-1 size-4"
            />
            <label htmlFor={`${id}-${file.id}`} className="font-medium">
              {file.role === "source" ? "Cite " : "Publish example "}&quot;
              {file.title}&quot;
            </label>
          </div>
          {file.publish && file.role === "source" ? (
            <p className="text-xs font-medium">Cited by contributor</p>
          ) : null}
          {assistantSourceInputs.some((source) => source.fileId === file.id) ? (
            <p className="text-xs font-medium">
              Used by assistant · included with this definition
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-muted-foreground">
            {file.caption}
          </p>
          {file.citation ? <p>{file.citation}</p> : null}
          {file.page ? <p>Page or section: {file.page}</p> : null}
          <a className="underline" href={contributionFilePath(file.id)}>
            {file.filename} · {formatContributionFileSize(file.byteSize)}
          </a>
        </div>
      ))}
    </section>
  )
}
