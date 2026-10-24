"use client"

import { normalizeCommunityWorkReturnTo } from "@/lib/community-work-return"
import { normalizeMatcoreCatalogReturnTo } from "@/lib/matcore-catalog-navigation"
import { registerDraftNavigationGuard } from "@/lib/draft-navigation-guards"

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import type { MatCoreDraftPayload } from "@/lib/matcore-workflow-types"
import { TermDraftSaveQueue } from "@/lib/term-draft-save-queue"
import { FieldDraftRecovery } from "./field-draft-recovery"

export type FieldDraftRecord = RouterOutput["matcoreWorkflow"]["getDraft"]

const subscribeHydration = () => () => {}
const clientReady = () => true
const serverReady = () => false

/** Uses the term editor's retry-safe queue; input handlers update it immediately. */
export function useFieldDraft(initial: FieldDraftRecord) {
  // Server-rendered text must not be editable before React's input handlers
  // and the save/navigation guards are attached. Hydration can otherwise
  // replace a selection while a person's first input is being inserted.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientReady,
    serverReady
  )
  const router = useRouter()
  const utils = trpc.useUtils()
  const update = trpc.matcoreWorkflow.updateDraft.useMutation()
  const [, render] = useReducer((value: number) => value + 1, 0)
  const [recovery] = useState(
    () => new FieldDraftRecovery(initial.ownerId, initial.id)
  )
  const [recoveryChecked, setRecoveryChecked] = useState(false)
  const [queue] = useState(() => {
    let ready = false
    const instance = new TermDraftSaveQueue<
      MatCoreDraftPayload,
      FieldDraftRecord
    >(initial.payload, {
      create: async () => {
        throw new Error("Open a saved field draft before editing.")
      },
      update: (input) => update.mutateAsync(input),
      meaningful: () => true,
      uuid: () => crypto.randomUUID(),
      changed: () => {
        if (ready) {
          if (instance.record)
            recovery.capture(instance.record, instance.payload, instance.dirty)
          render()
        }
      }
    })
    instance.restore(initial)
    ready = true
    return instance
  })
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState<unknown>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!hydrated || recoveryChecked) return
    const restored = recovery.load(initial)
    if (restored.kind === "recover" || restored.kind === "conflict") {
      // Do not rebase unsaved work onto a version saved by another editor.
      // Set the payload once, before enabling controls or autosave.
      recovery.withoutCapturing(() =>
        queue.restore(
          { ...initial, version: restored.entry.baseVersion },
          restored.entry.payload,
          { requireAcknowledgement: true }
        )
      )
      if (restored.kind === "conflict")
        // The queue is an imperative store; React renders its snapshot below.
        // eslint-disable-next-line react-hooks/immutability
        queue.error = Object.assign(
          new Error(
            "The saved draft changed while your unsaved writing was away. Copy any changes you want to keep before reloading the saved draft."
          ),
          { data: { code: "CONFLICT" } }
        )
    }
    // Hydrate browser-only recovery before permitting input or autosave.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecoveryChecked(true)
  }, [hydrated, initial, queue, recovery, recoveryChecked])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (queue.dirty && !recovery.recovered) void queue.flush().catch(() => {})
    }
  }, [queue, recovery])

  const serialized = JSON.stringify(queue.payload)
  useEffect(() => {
    if (
      !recoveryChecked ||
      recovery.recovered ||
      !queue.dirty ||
      queue.error ||
      reloading
    )
      return
    const timer = window.setTimeout(
      () => void queue.flush().catch(() => {}),
      700
    )
    return () => window.clearTimeout(timer)
  }, [queue, serialized, reloading, recovery, recoveryChecked])

  useEffect(() => {
    let navigating = false
    const unregister = registerDraftNavigationGuard(async () => {
      if (queue.dirty) await queue.flush()
    })
    const followLink = (event: MouseEvent) => {
      if (
        !queue.dirty ||
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
        target.origin !== location.origin ||
        (target.pathname === location.pathname &&
          target.search === location.search)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (navigating) return
      navigating = true
      void queue
        .flush()
        .then(() => {
          const href = `${target.pathname}${target.search}${target.hash}`
          if (
            anchor.dataset.draftNavigation === "document" &&
            (normalizeCommunityWorkReturnTo(href) ||
              normalizeMatcoreCatalogReturnTo(href))
          )
            window.location.assign(href)
          else router.push(href)
        })
        .catch(() => {})
        .finally(() => {
          navigating = false
        })
    }
    const protect = (event: BeforeUnloadEvent) => {
      if (!queue.dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    const saveHidden = () => {
      if (document.visibilityState === "hidden" && queue.dirty)
        void queue.flush().catch(() => {})
    }
    const saveBack = () => {
      if (queue.dirty) void queue.flush().catch(() => {})
    }
    document.addEventListener("click", followLink, true)
    document.addEventListener("visibilitychange", saveHidden)
    window.addEventListener("beforeunload", protect)
    window.addEventListener("popstate", saveBack)
    return () => {
      unregister()
      document.removeEventListener("click", followLink, true)
      document.removeEventListener("visibilitychange", saveHidden)
      window.removeEventListener("beforeunload", protect)
      window.removeEventListener("popstate", saveBack)
    }
  }, [queue, router])

  async function reload() {
    if (queue.saving || reloading) return
    setReloading(true)
    setReloadError(null)
    try {
      const record = await utils.client.matcoreWorkflow.getDraft.query({
        id: initial.id
      })
      if (mounted.current) {
        recovery.discard()
        queue.restore(record)
      }
    } catch (error) {
      if (mounted.current) setReloadError(error)
    } finally {
      if (mounted.current) setReloading(false)
    }
  }

  const conflict =
    (queue.error as { data?: { code?: string } } | null)?.data?.code ===
    "CONFLICT"
  return {
    ready: hydrated && recoveryChecked,
    recovered: recovery.recovered,
    recoveryWarning: recovery.warning,
    payload: queue.payload,
    record: queue.record ?? initial,
    setPayload: (payload: MatCoreDraftPayload) => queue.update(payload),
    dirty: queue.dirty,
    saving: queue.saving,
    error: reloadError ?? queue.error,
    conflict,
    reloading,
    reload,
    flush: () => queue.flush(),
    retry: () => (reloadError ? reload() : queue.flush(true)),
    stop: () => {
      recovery.discard()
      queue.stop()
    }
  }
}
