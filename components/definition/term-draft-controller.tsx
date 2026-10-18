"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type SetStateAction
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import type { TermDraftPayload } from "@/lib/term-draft-types"
import { TermDraftSaveQueue } from "@/lib/term-draft-save-queue"
import { compactTermDraftPayload } from "@/lib/term-draft-persistence"
import { Button } from "@/components/ui/button"

export type SavedTermDraft = RouterOutput["termDrafts"]["get"]
const meaningful = (p: TermDraftPayload) =>
  !!(
    p.term.trim() ||
    p.definition.trim() ||
    p.initialExample.trim() ||
    p.files.length ||
    p.aiSuggestionId
  )

export function useTermDraft({
  draftId,
  ownerId,
  initialPayload,
  enabled = true,
  onRestore,
  onSaved
}: {
  draftId?: string
  ownerId: number
  initialPayload: TermDraftPayload
  enabled?: boolean
  onRestore?: (record: SavedTermDraft) => void
  onSaved?: (record: SavedTermDraft) => void
}) {
  const utils = trpc.useUtils()
  const router = useRouter()
  const create = trpc.termDrafts.create.useMutation()
  const update = trpc.termDrafts.update.useMutation()
  const publishMutation = trpc.termDrafts.publish.useMutation()
  const [, render] = useReducer((n: number) => n + 1, 0)
  const mounted = useRef(false)
  const latest = useRef({ create, update, onRestore, onSaved })
  useLayoutEffect(() => {
    latest.current = { create, update, onRestore, onSaved }
  }, [create, update, onRestore, onSaved])
  const [loading, setLoading] = useState(!!draftId && enabled)
  const [loadError, setLoadError] = useState<unknown>(null)
  const canSaveOnLeave = useRef(false)
  useLayoutEffect(() => {
    canSaveOnLeave.current = enabled && !loading && !loadError
  }, [enabled, loading, loadError])
  const [queue] = useState(
    () =>
      new TermDraftSaveQueue<TermDraftPayload, SavedTermDraft>(
        compactTermDraftPayload(initialPayload),
        {
          create: (input) =>
            create.mutateAsync({ ...input, expectedOwnerId: ownerId }),
          update: (input) => update.mutateAsync(input),
          meaningful,
          uuid: () => crypto.randomUUID(),
          changed: render
        }
      )
  )
  const restoredId = useRef<string | null>(null)
  useLayoutEffect(() => {
    // Every save path (debounce, navigation, mode switch and explicit flush)
    // acknowledges the stable ID synchronously before its promise resolves.
    return queue.setOnSaved((record) => latest.current.onSaved?.(record))
  }, [queue])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (canSaveOnLeave.current && queue.dirty)
        void queue.flush().catch(() => {})
    }
  }, [queue])
  const reload = useCallback(async () => {
    const id = queue.record?.id ?? draftId
    if (!enabled || !id || queue.saving) return
    setLoading(true)
    setLoadError(null)
    try {
      const record = await utils.client.termDrafts.get.query({ id })
      if (!mounted.current) return
      queue.restore(
        record,
        record.payload ? compactTermDraftPayload(record.payload) : null
      )
      restoredId.current = id
      latest.current.onRestore?.(record)
    } catch (error) {
      if (mounted.current) setLoadError(error)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [draftId, enabled, queue, utils.client])
  useEffect(() => {
    if (
      enabled &&
      draftId &&
      queue.record?.id !== draftId &&
      restoredId.current !== draftId
    )
      void reload()
  }, [draftId, enabled, reload, queue])
  const setPayload = useCallback(
    (next: SetStateAction<TermDraftPayload>) => {
      if (!enabled) return
      queue.update(
        compactTermDraftPayload(
          typeof next === "function" ? next(queue.payload) : next
        )
      )
    },
    [enabled, queue]
  )
  const flush = useCallback(async () => {
    if (!enabled) return null
    if (loading || loadError)
      throw loadError ?? new Error("The draft is still loading.")
    return queue.flush()
  }, [enabled, loading, loadError, queue])
  useEffect(() => {
    if (!enabled) return
    let navigating = false
    const followLink = (event: MouseEvent) => {
      if (
        !queue.dirty ||
        loading ||
        loadError ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null
      if (
        !anchor ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      )
        return
      const target = new URL(anchor.href, window.location.href)
      if (
        target.origin !== window.location.origin ||
        (target.pathname === window.location.pathname &&
          target.search === window.location.search)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (navigating) return
      navigating = true
      void queue
        .flush()
        .then(() =>
          router.push(`${target.pathname}${target.search}${target.hash}`)
        )
        .catch(() => {})
        .finally(() => {
          navigating = false
        })
    }
    const saveBackNavigation = () => {
      if (!loading && !loadError && queue.dirty)
        void queue.flush().catch(() => {})
    }
    document.addEventListener("click", followLink, true)
    window.addEventListener("popstate", saveBackNavigation)
    return () => {
      document.removeEventListener("click", followLink, true)
      window.removeEventListener("popstate", saveBackNavigation)
    }
  }, [enabled, loading, loadError, queue, router])
  const retry = useCallback(async () => {
    if (loadError) return reload()
    try {
      await queue.flush(true)
    } catch {
      /* The status keeps the error visible. */
    }
  }, [loadError, reload, queue])
  const serialized = JSON.stringify(queue.payload)
  useEffect(() => {
    if (!enabled || loading || loadError || queue.error || !queue.dirty) return
    const timer = setTimeout(() => {
      void queue.flush().catch(() => {})
    }, 700)
    return () => clearTimeout(timer)
  }, [enabled, loading, loadError, queue, serialized])
  useEffect(() => {
    if (!enabled) return
    const protect = (event: BeforeUnloadEvent) => {
      if (!queue.dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    const saveHidden = () => {
      if (document.visibilityState === "hidden" && !loading && !loadError)
        void queue.flush().catch(() => {})
    }
    window.addEventListener("beforeunload", protect)
    document.addEventListener("visibilitychange", saveHidden)
    return () => {
      window.removeEventListener("beforeunload", protect)
      document.removeEventListener("visibilitychange", saveHidden)
    }
  }, [enabled, loading, loadError, queue])
  const publish = useCallback(async () => {
    const record = await flush()
    if (!record) throw new Error("Write a term before publishing.")
    if (record.publication) return record.publication
    const result = await publishMutation.mutateAsync({
      id: record.id,
      expectedVersion: record.version
    })
    queue.stop()
    return result
  }, [flush, publishMutation, queue])
  const saveError = loadError ?? queue.error
  const error = saveError ?? publishMutation.error
  const conflict =
    (queue.error as { data?: { code?: string } } | null)?.data?.code ===
    "CONFLICT"
  const status = loading
    ? "loading"
    : error
      ? "error"
      : queue.saving
        ? "saving"
        : queue.dirty
          ? "unsaved"
          : queue.record
            ? "saved"
            : "empty"
  return {
    id: queue.record?.id ?? draftId,
    payload: queue.payload,
    setPayload,
    record: queue.record,
    loading,
    loadError,
    status,
    error,
    saveError,
    publicationError: publishMutation.error,
    clearPublicationError: publishMutation.reset,
    conflict,
    publishing: publishMutation.isPending,
    flush,
    retry,
    reload,
    publish
  }
}

export type TermDraftController = ReturnType<typeof useTermDraft>

export function DraftSaveStatus({ draft }: { draft: TermDraftController }) {
  const router = useRouter()
  const message =
    draft.error instanceof Error
      ? draft.error.message
      : "Your changes could not be saved."
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <p role={draft.error ? "alert" : "status"}>
        {draft.loading
          ? "Loading your draft…"
          : draft.conflict
            ? `${message} Your writing is still here.`
            : draft.publicationError && !draft.saveError
              ? `The term could not be published. ${draft.publicationError.message}`
              : draft.error
                ? message
                : draft.status === "saving"
                  ? "Saving draft…"
                  : draft.status === "unsaved"
                    ? "Unsaved changes"
                    : draft.status === "saved"
                      ? "Draft saved to your account"
                      : "Your writing saves privately as you go."}
      </p>
      {draft.saveError ? (
        <>
          {!draft.conflict && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void draft.retry()}
            >
              {draft.loadError ? "Retry loading" : "Retry save"}
            </Button>
          )}
          {draft.id && !draft.loadError && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (
                  window.confirm(
                    "Reload the saved draft? Unsaved writing in this editor will be replaced."
                  )
                )
                  void draft.reload()
              }}
            >
              Reload saved draft
            </Button>
          )}
        </>
      ) : null}
      {draft.record?.warnings.map((warning) => (
        <p key={warning} role="alert">
          {warning}
        </p>
      ))}
      <Link
        href="/profile/drafts"
        className="underline"
        onClick={async (event) => {
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            draft.loadError
          )
            return
          event.preventDefault()
          try {
            await draft.flush()
            router.push("/profile/drafts")
          } catch {
            /* Keep writing visible. */
          }
        }}
      >
        My drafts
      </Link>
    </div>
  )
}
