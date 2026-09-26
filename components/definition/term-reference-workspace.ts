"use client"

import { referenceText } from "@/lib/reference-text"
import {
  DEFAULT_WOLFRAM_OPTIONS,
  WOLFRAM_LOOKUP_LIMIT,
  type WolframLookupOptions
} from "@/lib/wolfram-query"
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react"
import type { inferRouterOutputs } from "@trpc/server"
import { trpc } from "@/trpc/client"
import type { AppRouter } from "@/trpc/routers/_app"
import { loginToast } from "@/components/login-toast"
import type { ReferenceSelection } from "@/lib/term-references"
import {
  MODEL_REFERENCE_LIMIT,
  type ReferenceProvider
} from "@/lib/reference-types"

export type DraftReferenceSelection = ReferenceSelection & {
  term: string
  provider: ReferenceProvider
  modelReferenceIds: string[]
}

export const selectedModelReferenceIds = (
  selections: DraftReferenceSelection[],
  term: string
) =>
  selections
    .filter((selection) => selection.term === term.trim().toLowerCase())
    .flatMap((selection) => selection.modelReferenceIds)

export const selectedRevisionReferences = (
  selections: DraftReferenceSelection[],
  term: string
) =>
  selections
    .filter((selection) => selection.term === term.trim().toLowerCase())
    .map(({ lookupId, citedReferenceIds }) => ({ lookupId, citedReferenceIds }))

export type ReferenceLookup =
  inferRouterOutputs<AppRouter>["termReferences"]["retrieveChebi"] & {
    request?: { input: string; context: string; options: WolframLookupOptions }
  }
type SelectionKind = "citedReferenceIds" | "modelReferenceIds"

export type ReferenceProviderState = {
  status: "idle" | "pending" | "ready" | "error"
  result: ReferenceLookup | null
  history: ReferenceLookup[]
  editing: boolean
  options: WolframLookupOptions
  error: string | null
  context: string
  notice: string
  clipboardBusy: boolean
  actionError: boolean
  showMore: boolean
  revealedReferenceIds: string[]
  consultedReferenceIds: string[]
}

type WorkspaceState = {
  key: string
  providers: Record<ReferenceProvider, ReferenceProviderState>
}
type WorkspaceOwner = WorkspaceState & {
  autoStarted: boolean
  requests: Record<ReferenceProvider, number>
}

const emptyProvider = (): ReferenceProviderState => ({
  status: "idle",
  result: null,
  history: [],
  editing: false,
  options: { ...DEFAULT_WOLFRAM_OPTIONS, assumptions: [] },
  error: null,
  context: "",
  notice: "",
  clipboardBusy: false,
  actionError: false,
  showMore: false,
  revealedReferenceIds: [],
  consultedReferenceIds: []
})
const emptyState = (key: string): WorkspaceState => ({
  key,
  providers: { chebi: emptyProvider(), wolfram: emptyProvider() }
})

export type TermReferenceWorkspace = {
  term: string
  enabled: boolean
  providers: WorkspaceState["providers"]
  selection: DraftReferenceSelection[]
  clearNotices: () => void
  retrieve: (provider: ReferenceProvider) => Promise<void>
  setWolframContext: (context: string) => void
  setWolframOptions: (options: WolframLookupOptions) => void
  refineWolfram: () => void
  cancelWolframRefinement: () => void
  viewWolframLookup: (lookupId: string) => void
  showAll: (provider: ReferenceProvider) => void
  setReferenceRevealed: (
    provider: ReferenceProvider,
    referenceId: string,
    revealed: boolean
  ) => void
  markConsulted: (provider: ReferenceProvider, referenceIds: string[]) => void
  modelInputAvailability: (referenceId: string) => ModelInputAvailability
  addModelInput: (provider: ReferenceProvider, referenceId: string) => boolean
  changeSelection: (
    provider: ReferenceProvider,
    referenceId: string,
    kind: SelectionKind,
    checked: boolean
  ) => void
  copy: (
    provider: ReferenceProvider,
    referenceId: string,
    text?: string
  ) => Promise<void>
  add: (
    provider: ReferenceProvider,
    referenceId: string,
    onAdd: (text: string) => boolean,
    text?: string
  ) => boolean
}

export const referenceLookups = (state: ReferenceProviderState) =>
  state.history.length ? state.history : state.result ? [state.result] : []

export type ModelInputAvailability = { allowed: boolean; reason: string | null }

/** Match the request's source limits before contributors add an input. */
export function modelInputAvailability(
  selection: DraftReferenceSelection[],
  providers: Record<ReferenceProvider, ReferenceProviderState>,
  referenceId: string
): ModelInputAvailability {
  const selected = new Set(selection.flatMap((item) => item.modelReferenceIds))
  if (selected.has(referenceId)) return { allowed: true, reason: null }
  if (selected.size >= MODEL_REFERENCE_LIMIT)
    return {
      allowed: false,
      reason:
        "Six sources are already in assistant context. Remove one before adding another."
    }
  const entries = Object.values(providers).flatMap((state) =>
    referenceLookups(state).flatMap((lookup) => lookup.references)
  )
  const candidate = entries.find((reference) => reference.id === referenceId)
  if (!candidate)
    return { allowed: false, reason: "This source is no longer available." }
  const size = entries.reduce(
    (total, reference) =>
      total + (selected.has(reference.id) ? reference.definition.length : 0),
    candidate.definition.length
  )
  if (size > 24000)
    return {
      allowed: false,
      reason:
        "These sources would exceed the assistant context limit. Remove another source or use a shorter result."
    }
  return { allowed: true, reason: null }
}

/** Own this hook above steps and responsive views. Tools only render its state. */
export function useTermReferenceWorkspace({
  term,
  contextKey,
  enabled,
  autoStart = true,
  selection,
  onSelectionChange,
  onSelectionEdit
}: {
  term: string
  contextKey: string
  enabled: boolean
  /** Start the ChEBI lookup on its own. Simple waits for a view that shows it. */
  autoStart?: boolean
  selection: DraftReferenceSelection[]
  onSelectionChange: Dispatch<SetStateAction<DraftReferenceSelection[]>>
  onSelectionEdit?: () => void
}): TermReferenceWorkspace {
  const key = JSON.stringify([contextKey, term.trim().toLowerCase()])
  const [state, setState] = useState(() => emptyState(key))
  const owner = useRef<WorkspaceOwner>({
    ...state,
    autoStarted: false,
    requests: { chebi: 0, wolfram: 0 }
  })
  const mounted = useRef(false)
  const { mutateAsync: retrieveChebi } =
    trpc.termReferences.retrieveChebi.useMutation({ retry: false })
  const { mutateAsync: retrieveWolfram } =
    trpc.termReferences.retrieveWolfram.useMutation({ retry: false })
  const { mutateAsync: recordAction } =
    trpc.termReferences.recordAction.useMutation({ retry: false })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const update = useCallback(
    (
      current: WorkspaceOwner,
      provider: ReferenceProvider,
      patch: Partial<ReferenceProviderState>
    ) => {
      if (!mounted.current || owner.current !== current) return
      current.providers = {
        ...current.providers,
        [provider]: { ...current.providers[provider], ...patch }
      }
      setState({ key: current.key, providers: current.providers })
    },
    []
  )

  const retrieve = useCallback(
    async (provider: ReferenceProvider) => {
      const current = owner.current
      if (
        !enabled ||
        current.key !== key ||
        !term.trim() ||
        term.trim().length > 200 ||
        current.providers[provider].status === "pending" ||
        (current.providers[provider].result &&
          (provider === "chebi" || !current.providers[provider].editing)) ||
        (provider === "wolfram" &&
          current.providers.wolfram.history.length >= WOLFRAM_LOOKUP_LIMIT)
      )
        return
      const request = ++current.requests[provider]
      const context = current.providers[provider].context
      const options = current.providers[provider].options
      update(current, provider, { status: "pending", error: null, notice: "" })
      try {
        const result =
          provider === "chebi"
            ? await retrieveChebi({ term })
            : await retrieveWolfram({ term, context, options })
        if (
          !mounted.current ||
          owner.current !== current ||
          current.requests[provider] !== request
        )
          return
        update(current, provider, {
          status: "ready",
          result,
          editing: false,
          history: [...current.providers[provider].history, result]
        })
        onSelectionChange((prior) => {
          if (owner.current !== current) return prior
          return prior
            .filter((item) => item.lookupId !== result.lookupId)
            .concat({
              term: result.term,
              lookupId: result.lookupId,
              provider,
              citedReferenceIds: [],
              modelReferenceIds: []
            })
        })
      } catch (error) {
        if (
          !mounted.current ||
          owner.current !== current ||
          current.requests[provider] !== request
        )
          return
        const failure = error as {
          message?: string
          data?: { code?: string } | null
        }
        update(current, provider, {
          status: "error",
          error: failure.message || "The reference lookup could not finish."
        })
        if (failure.data?.code === "UNAUTHORIZED")
          loginToast(
            `retrieve ${provider === "chebi" ? "ChEBI" : "Wolfram"} resources`
          )
      }
    },
    [
      enabled,
      key,
      term,
      update,
      retrieveChebi,
      retrieveWolfram,
      onSelectionChange
    ]
  )

  useEffect(() => {
    if (owner.current.key !== key) {
      const next: WorkspaceOwner = {
        ...emptyState(key),
        autoStarted: false,
        requests: { chebi: 0, wolfram: 0 }
      }
      owner.current = next
      setState({ key, providers: next.providers })
      onSelectionChange([])
    }
    // Strict Mode effect replay and view changes must not duplicate retrieval.
    if (enabled && autoStart && !owner.current.autoStarted) {
      owner.current.autoStarted = true
      void retrieve("chebi")
    }
  }, [key, enabled, autoStart, retrieve, onSelectionChange])

  const getCurrent = (provider: ReferenceProvider, referenceId: string) => {
    const current = owner.current
    if (!enabled || current.key !== key) return null
    const result = referenceLookups(current.providers[provider]).find(
      (lookup) => lookup.references.some((item) => item.id === referenceId)
    )
    const reference = result?.references.find((item) => item.id === referenceId)
    return result && reference ? { current, result, reference } : null
  }

  const record = async (
    current: WorkspaceOwner,
    provider: ReferenceProvider,
    referenceId: string,
    action: "copied" | "added_to_draft"
  ) => {
    try {
      await recordAction({ referenceId, action })
    } catch {
      update(current, provider, { actionError: true })
    }
  }

  const changeSelection = (
    provider: ReferenceProvider,
    referenceId: string,
    kind: SelectionKind,
    checked: boolean,
    fromInsertion = false
  ) => {
    const found = getCurrent(provider, referenceId)
    if (!found) return
    // Adding text and its citation is one undoable action. Later explicit
    // choices invalidate that action's snapshot. Passive receipts do not.
    if (!fromInsertion) onSelectionEdit?.()
    if (!checked) update(found.current, provider, { notice: "" })
    onSelectionChange((prior) => {
      if (owner.current !== found.current) return prior
      const previous = prior.find(
        (item) => item.lookupId === found.result.lookupId
      )
      if (
        kind === "modelReferenceIds" &&
        checked &&
        !modelInputAvailability(prior, found.current.providers, referenceId)
          .allowed
      )
        return prior
      const next: DraftReferenceSelection = previous ?? {
        term: found.result.term,
        lookupId: found.result.lookupId,
        provider,
        citedReferenceIds: [],
        modelReferenceIds: []
      }
      return prior
        .filter((item) => item.lookupId !== found.result.lookupId)
        .concat({
          ...next,
          [kind]: checked
            ? [...new Set([...next[kind], referenceId])]
            : next[kind].filter((id) => id !== referenceId)
        })
    })
  }

  return {
    term,
    enabled,
    providers: state.key === key ? state.providers : emptyState(key).providers,
    selection,
    // Undo supersedes transient action feedback, but keeps lookup snapshots and
    // recorded copy/add events: those interactions still happened.
    clearNotices() {
      const current = owner.current
      if (current.key !== key) return
      for (const provider of ["chebi", "wolfram"] as const)
        if (current.providers[provider].notice)
          update(current, provider, { notice: "" })
    },
    retrieve,
    setWolframContext(context) {
      const current = owner.current
      if (
        current.key !== key ||
        current.providers.wolfram.status === "pending" ||
        (current.providers.wolfram.result && !current.providers.wolfram.editing)
      )
        return
      update(current, "wolfram", { context: context.slice(0, 1000) })
    },
    setWolframOptions(options) {
      const current = owner.current
      if (
        !enabled ||
        current.key !== key ||
        current.providers.wolfram.status === "pending" ||
        (current.providers.wolfram.result && !current.providers.wolfram.editing)
      )
        return
      update(current, "wolfram", { options })
    },
    refineWolfram() {
      const current = owner.current
      if (
        !enabled ||
        current.key !== key ||
        current.providers.wolfram.status === "pending" ||
        current.providers.wolfram.history.length >= WOLFRAM_LOOKUP_LIMIT
      )
        return
      update(current, "wolfram", { editing: true, notice: "", error: null })
    },
    cancelWolframRefinement() {
      const current = owner.current
      if (current.key !== key || current.providers.wolfram.status === "pending")
        return
      const result = current.providers.wolfram.result
      update(current, "wolfram", {
        editing: false,
        status: result ? "ready" : "idle",
        error: null,
        context: result?.request?.context ?? "",
        options: result?.request?.options ?? {
          ...DEFAULT_WOLFRAM_OPTIONS,
          assumptions: []
        }
      })
    },
    viewWolframLookup(lookupId) {
      const current = owner.current
      if (
        !enabled ||
        current.key !== key ||
        current.providers.wolfram.status === "pending"
      )
        return
      const result = current.providers.wolfram.history.find(
        (lookup) => lookup.lookupId === lookupId
      )
      if (!result) return
      update(current, "wolfram", {
        result,
        status: "ready",
        editing: false,
        notice: "",
        error: null,
        context: result.request?.context ?? "",
        options: result.request?.options ?? {
          ...DEFAULT_WOLFRAM_OPTIONS,
          assumptions: []
        }
      })
    },
    showAll(provider) {
      const current = owner.current
      if (current.key === key) update(current, provider, { showMore: true })
    },
    setReferenceRevealed(provider, referenceId, revealed) {
      const found = getCurrent(provider, referenceId)
      if (!found) return
      const state = found.current.providers[provider]
      update(found.current, provider, {
        revealedReferenceIds: revealed
          ? [...new Set([...state.revealedReferenceIds, referenceId])]
          : state.revealedReferenceIds.filter((id) => id !== referenceId),
        consultedReferenceIds: revealed
          ? [...new Set([...state.consultedReferenceIds, referenceId])]
          : state.consultedReferenceIds
      })
    },
    markConsulted(provider, referenceIds) {
      const current = owner.current
      if (!enabled || current.key !== key) return
      const state = current.providers[provider]
      const available = new Set(
        referenceLookups(state).flatMap((lookup) =>
          lookup.references.map((reference) => reference.id)
        )
      )
      const added = referenceIds.filter(
        (id) => available.has(id) && !state.consultedReferenceIds.includes(id)
      )
      if (!added.length) return
      update(current, provider, {
        consultedReferenceIds: [
          ...state.consultedReferenceIds,
          ...new Set(added)
        ]
      })
    },
    modelInputAvailability(referenceId) {
      return modelInputAvailability(
        selection,
        owner.current.providers,
        referenceId
      )
    },
    addModelInput(provider, referenceId) {
      const found = getCurrent(provider, referenceId)
      if (!found) return false
      const availability = modelInputAvailability(
        selection,
        found.current.providers,
        referenceId
      )
      if (!availability.allowed) {
        update(found.current, provider, {
          notice: availability.reason ?? "This source cannot be added."
        })
        return false
      }
      changeSelection(provider, referenceId, "modelReferenceIds", true)
      update(found.current, provider, {
        notice: "Added to assistant context for your next request."
      })
      return true
    },
    changeSelection,
    async copy(provider, referenceId, text) {
      const found = getCurrent(provider, referenceId)
      if (!found || found.current.providers[provider].clipboardBusy) return
      update(found.current, provider, {
        clipboardBusy: true,
        actionError: false
      })
      try {
        await navigator.clipboard.writeText(
          text ?? referenceText(found.reference)
        )
        if (!mounted.current || owner.current !== found.current) return
        update(found.current, provider, {
          notice: "Copied. To attach a citation, select Cite without inserting."
        })
        void record(found.current, provider, referenceId, "copied")
      } catch {
        update(found.current, provider, {
          notice:
            "Clipboard unavailable. Select and copy the source text manually."
        })
      } finally {
        update(found.current, provider, { clipboardBusy: false })
      }
    },
    add(provider, referenceId, onAdd, text) {
      const found = getCurrent(provider, referenceId)
      if (!found) return false
      const insertion = text ?? referenceText(found.reference)
      if (!insertion.trim()) return false
      if (!onAdd(insertion)) {
        update(found.current, provider, {
          notice:
            "This source would exceed the definition length limit. Copy a relevant portion instead."
        })
        return false
      }
      changeSelection(provider, referenceId, "citedReferenceIds", true, true)
      update(found.current, provider, {
        notice:
          "Added to your definition with a citation. You can remove the citation during review.",
        actionError: false
      })
      void record(found.current, provider, referenceId, "added_to_draft")
      return true
    }
  }
}
