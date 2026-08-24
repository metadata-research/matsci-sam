"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
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
import {
  STUDY_INSTRUCTIONS_MAX,
  STUDY_TITLE_MAX,
  localDateTimeToIso,
  studyWindowError
} from "@/lib/study-editor"
import type { AdminStudyOptions } from "@/lib/admin-study-queries"
import styles from "../admin.module.css"

type FormState = {
  title: string
  communityId: string
  collectionId: string
  opensAt: string
  closesAt: string
  instructions: string
}

const initialForm = (options: AdminStudyOptions): FormState => ({
  title: "",
  communityId: options.communities[0]?.id.toString() ?? "",
  collectionId: options.collections[0]?.id.toString() ?? "",
  opensAt: "",
  closesAt: "",
  instructions: ""
})

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The study could not be created."

export function CreateStudyDialog({ options }: { options: AdminStudyOptions }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => initialForm(options))
  const [error, setError] = useState<string | null>(null)
  const create = trpc.admin.studies.create.useMutation({
    onSuccess: (study) => {
      toast.success("Study created")
      setForm(initialForm(options))
      setError(null)
      setOpen(false)
      router.push(`/admin/studies/${study.id}`)
      router.refresh()
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  const ready = options.communities.length > 0 && options.collections.length > 0
  const missingCommunities = options.communities.length === 0
  const missingCollections = options.collections.length === 0

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    try {
      const title = form.title.trim()
      if (!title) throw new Error("Enter a study title.")
      if (!form.communityId) throw new Error("Choose a community.")
      if (!form.collectionId) throw new Error("Choose a collection.")
      const opensAt = localDateTimeToIso(form.opensAt)
      const closesAt = localDateTimeToIso(form.closesAt)
      const windowError = studyWindowError(opensAt, closesAt)
      if (windowError) throw new Error(windowError)

      create.mutate({
        title,
        communityId: Number(form.communityId),
        collectionId: Number(form.collectionId),
        opensAt,
        closesAt,
        instructions: form.instructions
      })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const set = (field: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  return (
    <div className={styles.studyCreateControl}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (create.isPending) return
          setOpen(next)
          if (!next) setError(null)
        }}
      >
        {ready ? (
          <DialogTrigger asChild>
            <Button>
              <PlusIcon data-icon="inline-start" aria-hidden />
              New study
            </Button>
          </DialogTrigger>
        ) : (
          <Button
            type="button"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled="true"
            aria-describedby="study-create-requirements"
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            New study
          </Button>
        )}
        <DialogContent
          className={styles.studyDialog}
          showCloseButton={!create.isPending}
        >
          <DialogHeader>
            <DialogTitle>Create a study</DialogTitle>
            <DialogDescription>
              Connect an existing community and collection, then write the block
              participants will read first.
            </DialogDescription>
          </DialogHeader>

          <form className={styles.studyForm} onSubmit={submit}>
            <div className={styles.studyField}>
              <label className={styles.studyFieldLabel} htmlFor="study-title">
                Title
              </label>
              <Input
                id="study-title"
                autoFocus
                maxLength={STUDY_TITLE_MAX}
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                disabled={create.isPending}
                required
              />
            </div>

            <div className={styles.studyFormGrid}>
              <div className={styles.studyField}>
                <label
                  className={styles.studyFieldLabel}
                  htmlFor="study-community"
                >
                  Community
                </label>
                <select
                  id="study-community"
                  className={styles.studySelect}
                  value={form.communityId}
                  onChange={(event) => set("communityId", event.target.value)}
                  disabled={create.isPending}
                  required
                >
                  {options.communities.map((community) => (
                    <option key={community.id} value={community.id}>
                      {community.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.studyField}>
                <label
                  className={styles.studyFieldLabel}
                  htmlFor="study-collection"
                >
                  Collection
                </label>
                <select
                  id="study-collection"
                  className={styles.studySelect}
                  value={form.collectionId}
                  onChange={(event) => set("collectionId", event.target.value)}
                  disabled={create.isPending}
                  required
                >
                  {options.collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset className={styles.studyFieldset}>
              <legend className={styles.studyFieldLabel}>Schedule</legend>
              <p
                id="study-create-schedule-hint"
                className={styles.studyFieldHint}
              >
                Optional. Times are entered and displayed in UTC.
              </p>
              <div className={styles.studyFormGrid}>
                <div className={styles.studyField}>
                  <label
                    className={styles.studyFieldLabel}
                    htmlFor="study-opens"
                  >
                    Opens
                  </label>
                  <Input
                    id="study-opens"
                    type="datetime-local"
                    value={form.opensAt}
                    onChange={(event) => set("opensAt", event.target.value)}
                    disabled={create.isPending}
                    aria-describedby="study-create-schedule-hint"
                  />
                </div>
                <div className={styles.studyField}>
                  <label
                    className={styles.studyFieldLabel}
                    htmlFor="study-closes"
                  >
                    Closes
                  </label>
                  <Input
                    id="study-closes"
                    type="datetime-local"
                    value={form.closesAt}
                    onChange={(event) => set("closesAt", event.target.value)}
                    disabled={create.isPending}
                    aria-describedby="study-create-schedule-hint"
                  />
                </div>
              </div>
            </fieldset>

            <div className={styles.studyField}>
              <div className={styles.studyFieldHeading}>
                <label
                  className={styles.studyFieldLabel}
                  htmlFor="study-instructions"
                >
                  Instructions
                </label>
                <span className={styles.studyCharacterCount}>
                  {form.instructions.length}/{STUDY_INSTRUCTIONS_MAX}
                </span>
              </div>
              <Textarea
                id="study-instructions"
                className={styles.studyCreateTextarea}
                maxLength={STUDY_INSTRUCTIONS_MAX}
                value={form.instructions}
                onChange={(event) => set("instructions", event.target.value)}
                disabled={create.isPending}
                aria-describedby="study-create-instructions-hint"
              />
              <p
                id="study-create-instructions-hint"
                className={styles.studyFieldHint}
              >
                Plain text. Leave a blank line between paragraphs.
              </p>
            </div>

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
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !ready}>
                {create.isPending ? "Creating…" : "Create study"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {!ready && (
        <p
          id="study-create-requirements"
          className={styles.studyCreateRequirement}
        >
          Create or restore{" "}
          {missingCommunities && (
            <Link href="/communities">an active community</Link>
          )}
          {missingCommunities && missingCollections && " and "}
          {missingCollections && (
            <Link href="/collections">an active collection</Link>
          )}{" "}
          first.
        </p>
      )}
    </div>
  )
}
