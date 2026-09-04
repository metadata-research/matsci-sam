"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  SaveIcon,
  ShieldAlertIcon
} from "lucide-react"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StudyInstructionContent } from "@/components/studies/instruction-content"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  STUDY_INSTRUCTIONS_MAX,
  STUDY_TITLE_MAX,
  isoToLocalDateTime,
  localDateTimeToIso,
  normalizeStudyInstructions,
  studyWindowError
} from "@/lib/study-editor"
import type { StudyState } from "@/lib/communities"
import styles from "../admin.module.css"

type StudyEditorModel = {
  id: number
  slug: string
  title: string
  welcome: string | null
  opensAt: string | null
  closesAt: string | null
  retiredAt: string | null
  parentRetired: boolean
  createdLabel: string
  communitySlug: string
  communityTitle: string
  collectionSlug: string
  collectionTitle: string
  steps: number
  activity: number
  state: StudyState
  defaultInstructions: string
  effectiveInstructions: string
  instructionsEditable: boolean
  instructionLockReason: string | null
  hasCopyDrift: boolean
}

const STATE_LABEL: Record<StudyState, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  retired: "Retired"
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The study could not be saved."

const DISCARD_DRAFT_MESSAGE =
  "You have unsaved study changes. Leave this page and discard them?"

const useUnsavedDraftGuard = (hasDraftChanges: boolean) => {
  const allowNextUnload = useRef(false)

  useEffect(() => {
    if (!hasDraftChanges) return

    const protectHardNavigation = (event: BeforeUnloadEvent) => {
      if (allowNextUnload.current) return
      event.preventDefault()
      event.returnValue = ""
    }

    const protectLinkNavigation = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return

      const target = event.target
      if (!(target instanceof Element)) return

      const link = target.closest("a[href]")
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download"))
        return

      const linkTarget = link.target.toLowerCase()
      if (linkTarget && !["_self", "_parent", "_top"].includes(linkTarget))
        return

      const destination = new URL(link.href, window.location.href)
      if (destination.protocol !== "http:" && destination.protocol !== "https:")
        return

      const current = new URL(window.location.href)
      const staysOnCurrentDocument =
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search
      if (staysOnCurrentDocument) return

      if (!window.confirm(DISCARD_DRAFT_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      // A confirmed external or non-client navigation also emits beforeunload.
      // Let that one unload pass without showing a second browser prompt, then
      // restore protection if another handler ultimately cancels navigation.
      allowNextUnload.current = true
      window.setTimeout(() => {
        allowNextUnload.current = false
      }, 1_000)
    }

    window.addEventListener("beforeunload", protectHardNavigation)
    document.addEventListener("click", protectLinkNavigation, true)

    return () => {
      window.removeEventListener("beforeunload", protectHardNavigation)
      document.removeEventListener("click", protectLinkNavigation, true)
    }
  }, [hasDraftChanges])
}

export function StudyEditor({ study }: { study: StudyEditorModel }) {
  const router = useRouter()
  const initialOpensAt = isoToLocalDateTime(study.opensAt)
  const initialClosesAt = isoToLocalDateTime(study.closesAt)
  const [title, setTitle] = useState(study.title)
  const [instructions, setInstructions] = useState(study.effectiveInstructions)
  const [opensAt, setOpensAt] = useState(initialOpensAt)
  const [closesAt, setClosesAt] = useState(initialClosesAt)
  const [error, setError] = useState<string | null>(null)

  const titleChanged = title.trim() !== study.title
  const resolveInstructions = (value: string) =>
    normalizeStudyInstructions(value) ??
    (study.steps > 0 ? study.defaultInstructions : null)
  const instructionsChanged =
    resolveInstructions(instructions) !==
    resolveInstructions(study.effectiveInstructions)
  const opensChanged = opensAt !== initialOpensAt
  const closesChanged = closesAt !== initialClosesAt
  const retired = study.retiredAt !== null
  const unavailable = retired || study.parentRetired
  const canEditInstructions = study.instructionsEditable && !unavailable
  const canEditSchedule = study.activity === 0 && !unavailable
  const needsCopySync = study.hasCopyDrift && canEditInstructions
  const hasDraftChanges =
    titleChanged || instructionsChanged || opensChanged || closesChanged
  const hasSaveableChanges = hasDraftChanges || needsCopySync
  const previewText = resolveInstructions(instructions) ?? ""

  useUnsavedDraftGuard(hasDraftChanges)

  const update = trpc.admin.studies.update.useMutation({
    onSuccess: () => {
      toast.success("Study saved")
      setError(null)
      router.refresh()
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    try {
      const nextTitle = title.trim()
      if (!nextTitle) throw new Error("Enter a study title.")
      const nextOpensAt = localDateTimeToIso(opensAt)
      const nextClosesAt = localDateTimeToIso(closesAt)
      const windowError = studyWindowError(nextOpensAt, nextClosesAt)
      if (windowError) throw new Error(windowError)

      update.mutate({
        studyId: study.id,
        expected: {
          title: study.title,
          welcome: study.welcome,
          opensAt: study.opensAt,
          closesAt: study.closesAt,
          retiredAt: study.retiredAt
        },
        ...(titleChanged ? { title: nextTitle } : {}),
        ...(instructionsChanged || needsCopySync ? { instructions } : {}),
        ...(opensChanged ? { opensAt: nextOpensAt } : {}),
        ...(closesChanged ? { closesAt: nextClosesAt } : {})
      })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <form className={styles.studyEditorGrid} onSubmit={submit}>
      <div className={styles.studyEditorMain}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>Metadata</h2>
              <p className={styles.studyPanelDescription}>
                The public title and optional participation window.
              </p>
            </div>
            <Button
              type="submit"
              disabled={!hasSaveableChanges || update.isPending || unavailable}
            >
              <SaveIcon data-icon="inline-start" aria-hidden />
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
          <div className={styles.studyPanelBody}>
            <div className={styles.studyField}>
              <label className={styles.studyFieldLabel} htmlFor="edit-title">
                Title
              </label>
              <Input
                id="edit-title"
                maxLength={STUDY_TITLE_MAX}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={update.isPending || unavailable}
                required
              />
              <p className={styles.studyFieldHint}>
                Renaming does not change the permanent public address.
              </p>
            </div>

            <fieldset className={styles.studyFieldset}>
              <legend className={styles.studyFieldLabel}>Schedule</legend>
              <p
                id="study-edit-schedule-hint"
                className={styles.studyFieldHint}
              >
                Times are entered and displayed in UTC.
                {study.activity > 0 &&
                  " The schedule is locked after study activity."}
                {retired && " Restore this study before changing its schedule."}
                {!retired &&
                  study.parentRetired &&
                  " Restore its community and collection before changing its schedule."}
              </p>
              <div className={styles.studyFormGrid}>
                <div className={styles.studyField}>
                  <label
                    className={styles.studyFieldLabel}
                    htmlFor="edit-opens"
                  >
                    Opens
                  </label>
                  <Input
                    id="edit-opens"
                    type="datetime-local"
                    value={opensAt}
                    onChange={(event) => setOpensAt(event.target.value)}
                    disabled={update.isPending || !canEditSchedule}
                    aria-describedby="study-edit-schedule-hint"
                  />
                </div>
                <div className={styles.studyField}>
                  <label
                    className={styles.studyFieldLabel}
                    htmlFor="edit-closes"
                  >
                    Closes
                  </label>
                  <Input
                    id="edit-closes"
                    type="datetime-local"
                    value={closesAt}
                    onChange={(event) => setClosesAt(event.target.value)}
                    disabled={update.isPending || !canEditSchedule}
                    aria-describedby="study-edit-schedule-hint"
                  />
                </div>
              </div>
            </fieldset>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>Instructions</h2>
              <p className={styles.studyPanelDescription}>
                Plain text, shown to participants as paragraphs and numbered
                steps.
              </p>
            </div>
            <span className={styles.studyCharacterCount}>
              {instructions.length}/{STUDY_INSTRUCTIONS_MAX}
            </span>
          </div>
          <div className={styles.studyPanelBody}>
            {study.hasCopyDrift && (
              <div className={styles.studyNotice} role="status">
                <ShieldAlertIcon aria-hidden />
                <p>
                  The study page and study activity currently have different
                  instructions.
                  {canEditInstructions
                    ? " Saving this block will bring them back into sync."
                    : " A reviewed copy-sync operation is required to reconcile them."}
                </p>
              </div>
            )}
            {!canEditInstructions && (
              <div className={styles.studyNotice} role="status">
                <ShieldAlertIcon aria-hidden />
                <p>
                  {retired
                    ? "Restore this study before editing its instructions."
                    : study.parentRetired
                      ? "Restore this study's community and collection before editing its instructions."
                      : study.instructionLockReason}
                </p>
              </div>
            )}

            <Tabs defaultValue="edit">
              <TabsList aria-label="Instructions view">
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="edit">
                <label className="sr-only" htmlFor="edit-instructions">
                  Participant instructions
                </label>
                <Textarea
                  id="edit-instructions"
                  className={styles.studyInstructionTextarea}
                  maxLength={STUDY_INSTRUCTIONS_MAX}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  disabled={update.isPending || !canEditInstructions}
                  aria-describedby="instructions-hint"
                />
                <p id="instructions-hint" className={styles.studyFieldHint}>
                  Plain text only. Leave a blank line between paragraphs. Keep
                  numbered steps on consecutive lines.
                </p>
              </TabsContent>
              <TabsContent value="preview">
                <div className={styles.studyPreview}>
                  <StudyInstructionContent
                    text={previewText}
                    className={styles.studyPreviewParagraphs}
                    empty={
                      <p className={styles.studyPreviewEmpty}>
                        Nothing has been written yet.
                      </p>
                    }
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {error && (
          <p className={styles.studyFormError} role="alert">
            {error}
          </p>
        )}
      </div>

      <aside className={styles.studyEditorSidebar}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Integrity</h2>
            <Badge variant={retired ? "secondary" : "outline"}>
              {STATE_LABEL[study.state]}
            </Badge>
          </div>
          <dl className={styles.studyFacts}>
            <div>
              <dt>Public slug</dt>
              <dd className={styles.codeText}>/{study.slug}</dd>
            </div>
            <div>
              <dt>Community</dt>
              <dd>
                <Link href={`/communities/${study.communitySlug}`}>
                  {study.communityTitle}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Collection</dt>
              <dd>
                <Link href={`/collections/${study.collectionSlug}`}>
                  {study.collectionTitle}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Study steps</dt>
              <dd>
                {study.steps === 0 ? (
                  <Link href={`/communities/${study.communitySlug}`}>
                    Not prepared — open community controls
                  </Link>
                ) : (
                  `${study.steps} ${study.steps === 1 ? "step" : "steps"}`
                )}
              </dd>
            </div>
            <div>
              <dt>Recorded activity</dt>
              <dd>{study.activity}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{study.createdLabel}</dd>
            </div>
          </dl>
          <div className={styles.studyIntegrityFooter}>
            {canEditInstructions ? (
              <>
                <CheckCircle2Icon aria-hidden />
                Instructions can still be changed safely.
              </>
            ) : (
              <>
                <ShieldAlertIcon aria-hidden />
                Protocol copy is protected.
              </>
            )}
          </div>
        </section>

        <LifecycleControl study={study} hasUnsavedChanges={hasDraftChanges} />
      </aside>
    </form>
  )
}

function LifecycleControl({
  study,
  hasUnsavedChanges
}: {
  study: StudyEditorModel
  hasUnsavedChanges: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const retired = study.retiredAt !== null
  const restoreBlocked = retired && study.parentRetired
  const lifecycle = trpc.admin.studies.setRetired.useMutation({
    onSuccess: () => {
      toast.success(retired ? "Study restored" : "Study retired")
      setOpen(false)
      setError(null)
      router.refresh()
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Lifecycle</h2>
      </div>
      <div className={styles.studyLifecycleBody}>
        <p>
          {restoreBlocked
            ? "Restore the community and collection before restoring this study."
            : retired
              ? "Restore this study to make it active again."
              : study.parentRetired
                ? "A parent record is retired, so this study is suspended. Retiring it keeps the study retired after its parent returns."
                : "Retiring keeps its address and record, but stops participation."}
        </p>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (lifecycle.isPending) return
            setOpen(next)
            if (!next) setError(null)
          }}
        >
          <DialogTrigger asChild>
            <Button
              type="button"
              variant={retired ? "outline" : "destructive"}
              className={styles.studyLifecycleButton}
              disabled={restoreBlocked}
            >
              {retired ? (
                <ArchiveRestoreIcon data-icon="inline-start" aria-hidden />
              ) : (
                <ArchiveIcon data-icon="inline-start" aria-hidden />
              )}
              {retired ? "Restore study" : "Retire study"}
            </Button>
          </DialogTrigger>
          <DialogContent showCloseButton={!lifecycle.isPending}>
            <DialogHeader>
              <DialogTitle>
                {retired
                  ? "Restore this study?"
                  : hasUnsavedChanges
                    ? "Retire this study and discard changes?"
                    : "Retire this study?"}
              </DialogTitle>
              <DialogDescription>
                {retired
                  ? "The public page will remain at the same address and participation can resume according to its schedule."
                  : hasUnsavedChanges
                    ? "Your unsaved editor changes will be discarded. The public page and all recorded activity remain, but invitations and participation stop until the study is restored."
                    : "The public page and all recorded activity remain, but invitations and participation stop until the study is restored."}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p className={styles.studyFormError} role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={lifecycle.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={retired ? "default" : "destructive"}
                disabled={lifecycle.isPending}
                onClick={() =>
                  lifecycle.mutate({
                    studyId: study.id,
                    retired: !retired,
                    expectedRetiredAt: study.retiredAt
                  })
                }
              >
                {lifecycle.isPending
                  ? retired
                    ? "Restoring…"
                    : "Retiring…"
                  : retired
                    ? "Restore study"
                    : hasUnsavedChanges
                      ? "Retire and discard changes"
                      : "Retire study"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  )
}
