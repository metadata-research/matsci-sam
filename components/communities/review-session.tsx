"use client"

import Link from "next/link"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import {
  FieldRuleOverview,
  SpecificationComparison
} from "@/components/metadata-workspace/field-specification"
import { InfoPopover } from "@/components/info-popover"
import { registerDraftNavigationGuard } from "@/lib/draft-navigation-guards"
import {
  saveReviewSchema,
  type ReviewResponse
} from "@/lib/community-review-types"
import type { z } from "zod"

const subscribeHydration = () => () => {}
const clientReady = () => true
const serverReady = () => false

type Review = RouterOutput["communityReviews"]["get"]
type Item = Review["items"][number]
type Pending = z.output<typeof saveReviewSchema>
type LocalResponse = {
  response: ReviewResponse | null
  comment: string
  version: number
  pending?: Pending
}

export function CommunityReviewSession({
  roundId,
  itemId,
  userId,
  communityId
}: {
  roundId: string
  itemId?: string
  userId: number | null
  communityId: number
}) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientReady,
    serverReady
  )
  const query = trpc.communityReviews.get.useQuery(
    { id: roundId },
    { refetchOnWindowFocus: false }
  )
  const [filter, setFilter] = useState("unreviewed")
  const [selected, setSelected] = useState(itemId)
  const [skipped, setSkipped] = useState<string[]>([])
  const saveCurrent = useRef<() => Promise<unknown>>(async () => {})
  const registerSave = useCallback((fn: () => Promise<unknown>) => {
    saveCurrent.current = fn
  }, [])
  const navigating = useRef(false)
  const [error, setError] = useState("")
  async function move(action: () => void) {
    if (navigating.current) return
    navigating.current = true
    setError("")
    try {
      await saveCurrent.current()
      action()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Save your response before leaving."
      )
    } finally {
      navigating.current = false
    }
  }
  if (!hydrated || query.isPending) return <p role="status">Loading review…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  const data = query.data
  if (data.community.id !== communityId)
    return <p role="alert">This review belongs to another community.</p>
  const responded = data.items.filter((item) => item.own?.response).length
  const filtered = data.items.filter(
    (item) =>
      filter === "all" ||
      (filter === "mine" ? item.own?.response : !item.own?.response)
  )
  const current =
    data.items.find((item) => item.id === selected) ??
    filtered.find((item) => !skipped.includes(item.id))
  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-3 sm:gap-5"
      aria-label="Review session"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0 break-words">
          <h2 className="text-xl font-semibold sm:text-2xl">
            {data.round.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {responded} of {data.items.length} reviewed
            {data.round.closedAt ? " · Closed" : ""}
          </p>
        </div>
        <InfoPopover label="About review responses">
          Responses refer to the version shown here. Organizers can see your
          name and comment. Reviewing a proposal does not accept it into the
          standard.
        </InfoPopover>
      </div>
      <div
        className="grid grid-cols-[1.3fr_1fr_0.8fr] gap-2 sm:flex sm:flex-wrap"
        role="group"
        aria-label="Review filter"
      >
        {[
          ["unreviewed", "Not yet reviewed"],
          ["mine", "My responses"],
          ["all", "All items"]
        ].map(([key, title]) => (
          <Button
            key={key}
            className="h-auto min-h-11 whitespace-normal px-2 sm:px-4"
            variant={filter === key ? "secondary" : "outline"}
            aria-pressed={filter === key}
            onClick={() =>
              void move(() => {
                setFilter(key)
                setSelected(undefined)
                setSkipped([])
              })
            }
          >
            {title}
          </Button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {current ? (
        <ReviewCard
          key={current.id}
          item={current}
          data={data}
          userId={userId}
          register={registerSave}
          refresh={async () => {
            setSelected(current.id)
            await query.refetch()
          }}
          next={() => {
            setSkipped((previous) => [...previous, current.id])
            setSelected(undefined)
          }}
        />
      ) : (
        <div className="rounded-xl border p-6">
          <h3 className="text-lg font-semibold">
            {filter === "unreviewed" && responded === data.items.length
              ? "Review complete"
              : "No more items in this view"}
          </h3>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              setFilter("all")
              setSkipped([])
            }}
          >
            View all items
          </Button>
        </div>
      )}
      {filtered.length > 0 && (
        <label className="flex flex-col gap-2 text-sm">
          Jump to an item
          <select
            aria-label="Jump to an item"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={current?.id ?? ""}
            onChange={(event) => {
              const id = event.target.value
              void move(() => setSelected(id))
            }}
          >
            <option value="" disabled>
              Select an item
            </option>
            {filtered.map((item) => (
              <option key={item.id} value={item.id}>
                {item.snapshot.label}
                {item.snapshot.path &&
                  item.snapshot.path !== item.snapshot.label &&
                  ` — ${item.snapshot.path}`}
                {` · ${item.snapshot.versionLabel}`}
                {item.own?.response ? " · reviewed" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  )
}

function ReviewCard({
  item,
  data,
  userId,
  register,
  refresh,
  next
}: {
  item: Item
  data: Review
  userId: number | null
  register: (fn: () => Promise<unknown>) => void
  refresh: () => Promise<void>
  next: () => void
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const mutation = trpc.communityReviews.save.useMutation()
  const suggest = trpc.communityReviews.suggest.useMutation()
  const initial: LocalResponse = {
    response: item.own?.response ?? null,
    comment: item.own?.comment ?? "",
    version: item.own?.version ?? 0
  }
  const key = "community-review:" + userId + ":" + item.id
  const [recovery] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const recovered = JSON.parse(raw)
        const checked = saveReviewSchema.safeParse({
          itemId: item.id,
          response: recovered.response,
          comment: recovered.comment,
          expectedVersion: recovered.version,
          mutationId: recovered.pending?.mutationId ?? crypto.randomUUID()
        })
        const pending = recovered.pending
          ? saveReviewSchema.safeParse(recovered.pending)
          : null
        if (
          checked.success &&
          (!pending || (pending.success && pending.data.itemId === item.id))
        ) {
          return {
            value: {
              response: checked.data.response,
              comment: checked.data.comment,
              version: checked.data.expectedVersion,
              ...(pending?.success ? { pending: pending.data } : {})
            } as LocalResponse,
            warning: false
          }
        }
      }
      return { value: initial, warning: false }
    } catch {
      return { value: initial, warning: true }
    }
  })
  const [value, setValue] = useState(recovery.value)
  const [commentOpen, setCommentOpen] = useState(
    Boolean(recovery.value.comment)
  )
  const valueRef = useRef(value)
  const saved = useRef(initial)
  const [savedValue, setSavedValue] = useState(initial)
  const flight = useRef<Promise<unknown> | null>(null)
  const actionLock = useRef(false)
  const ready = true
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [storageWarning, setStorageWarning] = useState(recovery.warning)
  const dirty = (current: LocalResponse) =>
    Boolean(current.pending) ||
    current.response !== saved.current.response ||
    current.comment !== saved.current.comment
  const isDirty =
    Boolean(value.pending) ||
    value.response !== savedValue.response ||
    value.comment !== savedValue.comment
  function keep(current: LocalResponse) {
    valueRef.current = current
    setValue(current)
    try {
      if (dirty(current)) sessionStorage.setItem(key, JSON.stringify(current))
      else sessionStorage.removeItem(key)
    } catch {
      setStorageWarning(true)
    }
  }
  async function persist() {
    if (flight.current) return flight.current
    const current = valueRef.current
    if (!dirty(current)) return
    if (!current.response && current.comment) {
      setError("Choose a response to save your comment.")
      throw new Error("Choose a response to save your comment.")
    }
    if (!data.canRespond)
      throw new Error(
        "This response cannot be saved. The review may be closed or your access may have changed."
      )
    const pending = current.pending ?? {
      itemId: item.id,
      response: current.response,
      comment: current.comment,
      expectedVersion: current.version,
      mutationId: crypto.randomUUID()
    }
    keep({ ...current, pending })
    setError("")
    setConflict(false)
    const request = mutation
      .mutateAsync(pending)
      .then((result) => {
        const latest = {
          response: result.response,
          comment: result.comment,
          version: result.version
        }
        saved.current = latest
        setSavedValue(latest)
        keep(latest)
        return result
      })
      .catch((failure) => {
        setError(failure.message)
        setConflict(failure.data?.code === "CONFLICT")
        throw failure
      })
      .finally(() => {
        flight.current = null
      })
    flight.current = request
    return request
  }
  const persistRef = useRef(persist)
  useLayoutEffect(() => {
    persistRef.current = persist
  })
  useEffect(() => {
    const save = () => persistRef.current()
    register(save)
    const unregister = registerDraftNavigationGuard(save)
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty(valueRef.current)) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !dirty(valueRef.current)
      )
        return
      const anchor = (event.target as Element).closest?.(
        "a[href]"
      ) as HTMLAnchorElement | null
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return
      const target = new URL(anchor.href)
      if (target.origin !== location.origin) return
      event.preventDefault()
      event.stopPropagation()
      void save()
        .then(() => router.push(target.pathname + target.search + target.hash))
        .catch(() => {})
    }
    window.addEventListener("beforeunload", unload)
    document.addEventListener("click", click, true)
    return () => {
      unregister()
      register(async () => {})
      window.removeEventListener("beforeunload", unload)
      document.removeEventListener("click", click, true)
    }
  }, [router, register]) // Save uses a ref so guards always see the current input.
  async function act(action: "save" | "next" | "suggest" | "withdraw") {
    if (actionLock.current) return
    actionLock.current = true
    try {
      if (action === "withdraw")
        keep({
          ...valueRef.current,
          response: null,
          comment: "",
          pending: undefined
        })
      await persist()
      await refresh()
      if (action === "next") next()
      if (action === "suggest") {
        const result = await suggest.mutateAsync({ itemId: item.id })
        router.push(result.href)
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your response could not be saved."
      )
    } finally {
      actionLock.current = false
    }
  }
  const rules = item.snapshot.payload?.specification
  const busy = mutation.isPending || suggest.isPending
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border p-4 sm:gap-5 sm:p-6"
      aria-labelledby="review-item-label"
    >
      <header>
        <p className="text-sm text-muted-foreground">
          {item.kind === "proposal"
            ? "Proposed change"
            : item.kind === "reference"
              ? "Reference field"
              : "Definition"}{" "}
          · {item.snapshot.versionLabel}
        </p>
        <h3
          id="review-item-label"
          className="mt-1 break-words text-xl font-semibold sm:text-2xl"
        >
          {item.snapshot.label}
        </h3>
        {item.snapshot.path && item.snapshot.path !== item.snapshot.label && (
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {item.snapshot.path}
          </p>
        )}
      </header>
      <p className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 sm:p-4">
        {item.snapshot.definition || "No definition provided."}
      </p>
      {rules && (
        <FieldRuleOverview
          specification={rules}
          profileKey={data.round.area}
          compact
        />
      )}
      {item.snapshot.payload?.rationale && (
        <p className="whitespace-pre-wrap text-sm">
          <strong>Reason for change: </strong>
          {item.snapshot.payload.rationale}
        </p>
      )}
      {item.snapshot.before && (
        <details>
          <summary className="cursor-pointer text-sm">
            Compare with the reference
          </summary>
          <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {item.snapshot.before.definition}
          </p>
          {rules && (
            <SpecificationComparison
              specification={rules}
              baseline={item.snapshot.before.specification}
              currentLabel="Reviewed version"
            />
          )}
        </details>
      )}
      <div className="flex flex-wrap gap-3">
        <Link className="text-sm underline" href={item.snapshot.targetHref}>
          Full entry and discussion
        </Link>
        {data.canRespond && (
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || busy}
            onClick={() => void act("suggest")}
          >
            Suggest a change
          </Button>
        )}
      </div>
      {!ready ? (
        <p role="status">Loading your response…</p>
      ) : (
        <>
          <fieldset
            disabled={
              !data.canRespond || busy || conflict || Boolean(value.pending)
            }
            className="flex flex-col gap-3"
          >
            <legend className="mb-3 font-medium">{item.preset.question}</legend>
            <div className="flex flex-wrap gap-2">
              {item.preset.options.map((option) => (
                <label
                  key={option.value}
                  className={
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm " +
                    (value.response === option.value
                      ? "border-primary bg-accent"
                      : "")
                  }
                >
                  <input
                    type="radio"
                    name={item.id}
                    value={option.value}
                    checked={value.response === option.value}
                    onChange={() =>
                      keep({ ...valueRef.current, response: option.value })
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <details
              open={commentOpen}
              onToggle={(event) => setCommentOpen(event.currentTarget.open)}
            >
              <summary className="min-h-11 cursor-pointer py-3 text-sm">
                Comment (optional)
              </summary>
              <label className="block">
                <span className="sr-only">Comment (optional)</span>
                <textarea
                  rows={3}
                  maxLength={4000}
                  className="w-full rounded-md border bg-background p-3 text-base sm:text-sm"
                  value={value.comment}
                  onChange={(event) =>
                    keep({ ...valueRef.current, comment: event.target.value })
                  }
                />
              </label>
            </details>
          </fieldset>
          <p role="status" className="text-sm text-muted-foreground">
            {busy
              ? "Saving response…"
              : isDirty
                ? "Unsaved response"
                : value.response
                  ? "Response saved"
                  : "No response yet"}
          </p>
          {storageWarning && (
            <p className="text-sm">
              Browser recovery is unavailable. Save before closing this page.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error} Your response is still here.
            </p>
          )}
          {conflict && (
            <Button
              variant="outline"
              onClick={async () => {
                const latest = await trpcClientReload()
                if (latest) {
                  saved.current = latest
                  setSavedValue(latest)
                  keep(latest)
                  setCommentOpen(Boolean(latest.comment))
                  setConflict(false)
                  setError("")
                }
              }}
            >
              Reload saved response
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {data.canRespond && (
              <>
                <Button
                  disabled={busy || conflict || !value.response}
                  onClick={() => void act("next")}
                >
                  {error && !conflict
                    ? "Retry save and continue"
                    : "Save and next"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || conflict || !value.response}
                  onClick={() => void act("save")}
                >
                  Save response
                </Button>
              </>
            )}
            <Button variant="ghost" disabled={busy || isDirty} onClick={next}>
              Skip for now
            </Button>
            {data.canRespond && value.response && !isDirty && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void act("withdraw")}
              >
                Withdraw response
              </Button>
            )}
          </div>
          {!data.canRespond && (
            <p className="text-sm text-muted-foreground">
              {data.round.closedAt
                ? "This review is closed. Your saved responses remain available."
                : "Join the community to respond."}
            </p>
          )}
        </>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">Response totals</summary>
        <ul className="mt-2">
          {item.preset.options.map((option) => (
            <li key={option.value}>
              {option.label}: {item.counts[option.value] ?? 0}
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
  async function trpcClientReload() {
    try {
      const latest = await utils.communityReviews.get.fetch(
        {
          id: data.round.id
        },
        { staleTime: 0 }
      )
      const own = latest.items.find((row) => row.id === item.id)?.own
      return {
        response: own?.response ?? null,
        comment: own?.comment ?? "",
        version: own?.version ?? 0
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reload.")
      return null
    }
  }
}
