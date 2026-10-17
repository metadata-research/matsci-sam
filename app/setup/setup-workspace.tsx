"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject
} from "react"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  communityPath,
  DEFAULT_VOCABULARY_SLUG,
  collectionPath,
  vocabularyPath,
  definitionPath,
  termPath
} from "@/lib/public-identifiers"
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "@/lib/input-limits"
import {
  initialSetupDraft,
  restoreSetupDraft,
  setupSteps,
  singleTermImportText,
  type SetupDraft,
  type SetupStep,
  type SetupTask
} from "@/lib/guided-setup"
import { cn } from "@/lib/utils"
import { profileCompletionPath } from "@/lib/auth-return"
import {
  isKnownSetupCreationRejection,
  newSetupCreationAttempt,
  restoreSetupCreationAttempt,
  setupCreationMatches,
  setupCreationStorageKey,
  type SetupCreationAttempt,
  type SetupCreationKind,
  type SetupCreationMatch
} from "@/lib/setup-creation-recovery"
import { SetupCreationRecovery } from "./creation-recovery"
import { DefinitionForm } from "@/components/definition/definition-form"
import {
  useTermDraft,
  DraftSaveStatus,
  type TermDraftController,
  type SavedTermDraft
} from "@/components/definition/term-draft-controller"
import { emptyTermDraftPayload } from "@/lib/term-draft-types"
import { changeSetupTerm, termDraftHasEvidence } from "@/lib/setup-term-draft"

type Options = RouterOutput["setup"]["options"]
type Preview = RouterOutput["setup"]["previewImport"]
type Props = {
  draftKey: string
  draftId?: string
  returnTo: string
  options: Options
  task?: SetupTask
  communityId?: number
  vocabularySlug: string
}
const labels: Record<SetupStep, string> = {
  community: "Community",
  vocabulary: "Vocabulary",
  collection: "Collection",
  terms: "Terms",
  review: "Review"
}
const titles: Record<SetupTask, string> = {
  community: "Create a community",
  vocabulary: "Create a vocabulary",
  collection: "Create a collection",
  import: "Import terms"
}
const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** Delay browser draft access until hydration; never render another user's draft. */
export function GuidedSetup(props: Props) {
  const hydrated = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot
  )
  const returnTo = props.returnTo
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href="/" className="w-fit text-sm text-primary hover:underline">
          Home
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {props.task ? titles[props.task] : "Guided setup"}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {props.task === "import"
            ? "Preview a batch of terms and definitions before adding them to a vocabulary."
            : "Use this guide to select or create a community, vocabulary, and optional collection, then add or import terms."}
        </p>
      </header>
      {!props.options.signedIn ? (
        <Alert>
          <AlertTitle>Sign in to get started</AlertTitle>
          <AlertDescription>
            <p>
              Choose an existing vocabulary or set up a place for your community
              to contribute.
            </p>
            <Button asChild className="mt-3">
              <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
                Sign in to continue
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : !hydrated ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <SetupWorkspace
          key={props.options.userId}
          {...props}
          returnTo={returnTo}
        />
      )}
    </>
  )
}

function SetupWorkspace({
  draftKey,
  draftId,
  options: initialOptions,
  task,
  communityId,
  vocabularySlug,
  returnTo
}: Props & { returnTo: string }) {
  const router = useRouter()
  const storageKey = `matsci:setup:v1:${initialOptions.userId}:${draftKey}`
  const fallback = initialSetupDraft({ task, communityId, vocabularySlug })
  const [draft, setDraft] = useState<SetupDraft>(() => {
    let restored = fallback
    try {
      restored = restoreSetupDraft(localStorage.getItem(storageKey), fallback)
    } catch {
      /* Setup still works without browser storage. */
    }
    return draftId && !task
      ? {
          ...restored,
          termDraftId: draftId,
          termDraftDestinationChanged: false,
          mode: "single",
          step: "terms",
          furthest: 3,
          receipt: null
        }
      : restored
  })
  const [browserStorageAvailable, setBrowserStorageAvailable] = useState(true)
  const singleTermEditor = useRef<TermDraftController | null>(null)
  const [creationAttempt, setCreationAttempt] =
    useState<SetupCreationAttempt | null>(() => {
      if (!initialOptions.userId || draft.receipt) return null
      try {
        return restoreSetupCreationAttempt(
          localStorage.getItem(setupCreationStorageKey(storageKey)),
          { userId: initialOptions.userId, storageKey }
        )
      } catch {
        return null
      }
    })
  const optionsQuery = trpc.setup.options.useQuery(undefined, {
    initialData: initialOptions
  })
  const options = optionsQuery.data ?? initialOptions
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [localBusy, setLocalBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const operation = useRef(false)
  const createCommunity = trpc.communities.create.useMutation()
  const createVocabulary = trpc.setup.createVocabulary.useMutation()
  const createCollection = trpc.collections.create.useMutation()
  const createWorklist = trpc.communities.createWorklistCollection.useMutation()
  const attachCollection = trpc.communities.setCollection.useMutation()
  const previewImport = trpc.setup.previewImport.useMutation()
  const importTerms = trpc.setup.importTerms.useMutation()
  const directCreate = task !== undefined && task !== "import"
  const steps: readonly SetupStep[] = directCreate
    ? [task]
    : task === "import"
      ? setupSteps.slice(1)
      : setupSteps
  const community = options.communities.find(
    (item) => String(item.id) === draft.communityId
  )
  const vocabulary = options.vocabularies.find(
    (item) => item.slug === draft.vocabularySlug
  )
  const collection = options.collections.find(
    (item) => String(item.id) === draft.collectionId
  )
  const busy =
    localBusy ||
    createCommunity.isPending ||
    createVocabulary.isPending ||
    createCollection.isPending ||
    createWorklist.isPending ||
    attachCollection.isPending ||
    previewImport.isPending ||
    importTerms.isPending

  useEffect(() => {
    if (options.userId !== initialOptions.userId) return
    let active = true
    let available = true
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft))
    } catch {
      available = false
    }
    queueMicrotask(() => {
      if (active) setBrowserStorageAvailable(available)
    })
    return () => {
      active = false
    }
  }, [draft, storageKey, options.userId, initialOptions.userId])

  function update(patch: Partial<SetupDraft>) {
    setDraft((current) => ({
      ...current,
      ...patch,
      ...(patch.vocabularySlug !== undefined || patch.collectionId !== undefined
        ? { termDraftDestinationChanged: true }
        : {}),
      ...(current.step === "review" && !patch.step
        ? { step: "terms" as const }
        : {})
    }))
    setPreview(null)
    setError("")
    setNotice("")
  }
  function go(step: SetupStep) {
    if (
      (draft.step === "terms" || draft.step === "review") &&
      draft.mode === "single" &&
      singleTermEditor.current
    ) {
      void perform(async () => {
        await singleTermEditor.current?.flush()
        moveTo(step)
      })
      return
    }
    moveTo(step)
  }
  function moveTo(step: SetupStep) {
    setDraft((current) => ({
      ...current,
      step,
      furthest: Math.max(current.furthest, setupSteps.indexOf(step))
    }))
    setError("")
    requestAnimationFrame(() => heading.current?.focus())
  }
  async function perform(work: () => Promise<void>) {
    if (operation.current) return
    if (options.userId !== initialOptions.userId) return
    operation.current = true
    setLocalBusy(true)
    setError("")
    try {
      await work()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Something went wrong. Your draft is still here; please try again."
      )
    } finally {
      operation.current = false
      setLocalBusy(false)
    }
  }
  function finish(title: string, href: string, detail: string) {
    setDraft((current) => ({ ...current, receipt: { title, href, detail } }))
  }
  function clearCreationAttempt() {
    try {
      localStorage.removeItem(setupCreationStorageKey(storageKey))
    } catch {
      /* The in-memory guard still works when storage is unavailable. */
    }
    setCreationAttempt(null)
  }
  function acknowledgeCreation(patch: Partial<SetupDraft>) {
    const next = {
      ...draft,
      ...patch,
      ...(patch.vocabularySlug !== undefined || patch.collectionId !== undefined
        ? { termDraftDestinationChanged: true }
        : {})
    }
    // Save the acknowledged destination/receipt before removing the pending
    // marker, so a reload cannot reopen the original creation form.
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* The current session can continue even when browser storage is full. */
    }
    setDraft(next)
    setPreview(null)
    setError("")
    clearCreationAttempt()
  }
  async function createSafely<T>(
    kind: SetupCreationKind,
    title: string,
    write: () => Promise<T>,
    resultDraft: (created: T) => Partial<SetupDraft>
  ) {
    if (creationAttempt || !initialOptions.userId)
      throw new Error(
        "Resolve the earlier creation request before trying again."
      )
    const attempt = newSetupCreationAttempt({
      userId: initialOptions.userId,
      storageKey,
      kind,
      title
    })
    try {
      localStorage.setItem(
        setupCreationStorageKey(storageKey),
        JSON.stringify(attempt)
      )
    } catch {
      /* In-memory recovery still prevents a blind retry in this session. */
    }
    setCreationAttempt(attempt)
    let created: T
    try {
      created = await write()
    } catch (failure) {
      if (isKnownSetupCreationRejection(failure)) clearCreationAttempt()
      else void optionsQuery.refetch()
      throw failure
    }
    acknowledgeCreation(resultDraft(created))
    return created
  }
  function useExistingCreation(match: SetupCreationMatch) {
    if (options.userId !== initialOptions.userId || busy) return
    const nextStep: SetupStep =
      match.kind === "community"
        ? "vocabulary"
        : match.kind === "vocabulary"
          ? "collection"
          : "terms"
    const destination: Partial<SetupDraft> =
      match.kind === "community"
        ? {
            communityId: String(match.id),
            vocabularySlug: match.vocabularySlug,
            collectionId: ""
          }
        : match.kind === "vocabulary"
          ? { communityId: "", vocabularySlug: match.slug, collectionId: "" }
          : { collectionId: String(match.id) }
    acknowledgeCreation({
      ...destination,
      ...(directCreate
        ? {
            receipt: {
              title: `${labels[match.kind]} selected`,
              href: match.href,
              detail: `Continue with ${match.title}. No additional ${match.kind} was created.`
            }
          }
        : {
            step: nextStep,
            furthest: Math.max(draft.furthest, setupSteps.indexOf(nextStep))
          })
    })
    setNotice(`Continuing with the existing ${match.kind}: ${match.title}.`)
  }
  function inputForImport() {
    return {
      vocabularySlug: draft.vocabularySlug,
      collectionId: draft.collectionId ? Number(draft.collectionId) : undefined,
      text:
        draft.mode === "single"
          ? singleTermImportText(draft.term, draft.definition)
          : draft.text,
      format: draft.mode === "single" ? ("csv" as const) : draft.format
    }
  }
  async function reviewTerms() {
    await perform(async () => {
      if (!vocabulary?.canContribute)
        throw new Error(
          "Choose a vocabulary you can contribute to before reviewing terms."
        )
      if (draft.collectionId && !collection)
        throw new Error(
          "That collection is no longer available. Choose another collection or skip it."
        )
      if (draft.mode === "single") {
        const saved = await singleTermEditor.current?.flush()
        if (!saved) throw new Error("Write a term before reviewing it.")
        setDraft((current) => ({ ...current, termDraftId: saved.id }))
        moveTo("review")
        return
      }
      const result = await previewImport.mutateAsync(inputForImport())
      setPreview(result)
      go("review")
    })
  }
  function selectVocabulary(slug: string) {
    const selected = options.vocabularies.find((item) => item.slug === slug)
    update({
      vocabularySlug: slug,
      communityId: selected?.communityId ? String(selected.communityId) : "",
      collectionId: ""
    })
  }
  const continueHref = new URLSearchParams()
  if (draft.communityId) continueHref.set("communityId", draft.communityId)
  if (draft.vocabularySlug)
    continueHref.set("vocabularySlug", draft.vocabularySlug)
  const addHref = `/add?${new URLSearchParams({ vocabularySlug: draft.vocabularySlug })}`

  if (options.userId !== initialOptions.userId)
    return (
      <Alert>
        <AlertTitle>Your signed-in account changed</AlertTitle>
        <AlertDescription>
          <p>
            Reload setup to continue with the current account. Your earlier
            draft stays with the account that started it.
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload setup
          </Button>
        </AlertDescription>
      </Alert>
    )

  if (
    creationAttempt &&
    !createCommunity.isPending &&
    !createVocabulary.isPending &&
    !createCollection.isPending &&
    !createWorklist.isPending
  )
    return (
      <SetupCreationRecovery
        attempt={creationAttempt}
        matches={setupCreationMatches(creationAttempt, options)}
        busy={busy || optionsQuery.isFetching}
        onRefresh={() => void optionsQuery.refetch()}
        onUseExisting={useExistingCreation}
        onRetry={() => {
          if (busy) return
          const step = creationAttempt.kind
          clearCreationAttempt()
          setError("")
          go(step)
        }}
      />
    )

  if (draft.receipt)
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{draft.receipt.title}</h2>
          </CardTitle>
          <CardDescription>{draft.receipt.detail}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={draft.receipt.href}>
                Open{" "}
                {task === "community"
                  ? "community"
                  : task === "collection"
                    ? "collection"
                    : draft.receipt.title === "Term published"
                      ? "term"
                      : "vocabulary"}
                <ArrowRightIcon aria-hidden data-icon="inline-end" />
              </Link>
            </Button>
            {directCreate ? (
              <Button asChild variant="outline">
                <Link href={`/setup?${continueHref}`}>
                  Continue with guided setup
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={addHref}>Add another term</Link>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(fallback)
                setPreview(null)
                setNotice("")
                setError("")
                if (draftId) {
                  const clean = new URL(returnTo, window.location.origin)
                  clean.searchParams.delete("draftId")
                  router.replace(`${clean.pathname}${clean.search}`)
                }
              }}
            >
              Start another setup
            </Button>
          </div>
        </CardContent>
      </Card>
    )

  return (
    <>
      {!directCreate ? (
        <nav aria-label="Setup progress">
          <ol className="flex flex-wrap gap-2">
            {steps.map((step, index) => (
              <li key={step}>
                <Button
                  variant={draft.step === step ? "default" : "outline"}
                  size="sm"
                  aria-current={draft.step === step ? "step" : undefined}
                  disabled={
                    busy ||
                    setupSteps.indexOf(step) > draft.furthest ||
                    (step === "review" &&
                      !preview &&
                      !(draft.mode === "single" && draft.termDraftId))
                  }
                  onClick={() => go(step)}
                >
                  <span aria-hidden>{index + 1}.</span> {labels[step]}
                  {step === "collection" ? " (optional)" : ""}
                </Button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {!options.profileComplete ? (
        <Alert>
          <AlertTitle>Complete your profile to define terms</AlertTitle>
          <AlertDescription>
            <p>
              Your contributions need an attributed name. You can still explore
              the setup steps.
            </p>
            <Link className="underline" href={profileCompletionPath(returnTo)}>
              Complete your profile
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {optionsQuery.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to refresh available destinations.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void optionsQuery.refetch()}
            >
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {draft.communityId && !community ? (
        <Alert>
          <AlertTitle>The selected community is unavailable</AlertTitle>
          <AlertDescription>
            <p>
              Your draft is still available. Choose another community or
              continue independently.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                update({
                  communityId: "",
                  vocabularySlug: DEFAULT_VOCABULARY_SLUG,
                  collectionId: ""
                })
                if (!directCreate)
                  go(task === "import" ? "vocabulary" : "community")
              }}
            >
              Continue without this community
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!directCreate &&
      (!vocabulary ||
        (options.profileComplete && !vocabulary.canContribute)) ? (
        <Alert>
          <AlertTitle>Choose an available vocabulary</AlertTitle>
          <AlertDescription>
            <p>
              You cannot currently contribute to the saved vocabulary. Your
              terms and definitions are still in this draft.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => go("vocabulary")}
            >
              Choose another vocabulary
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {draft.collectionId && !collection ? (
        <Alert>
          <AlertTitle>The saved collection is unavailable</AlertTitle>
          <AlertDescription>
            <p>
              You can choose another collection or keep the terms in their
              vocabulary without a collection.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => update({ collectionId: "" })}
            >
              Continue without this collection
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={heading} tabIndex={-1} className="outline-none">
              {draft.step === "terms"
                ? "Add your terms"
                : draft.step === "review"
                  ? "Review before publishing"
                  : `${directCreate ? "Create" : "Choose"} ${draft.step === "community" ? "a community" : draft.step === "vocabulary" ? "a vocabulary" : "a collection"}`}
            </h2>
          </CardTitle>
          <CardDescription>
            {draft.step === "community"
              ? "A community is a group of people. Creating one also creates its named vocabulary."
              : draft.step === "vocabulary"
                ? "A vocabulary gives terms a shared name and home. A standalone vocabulary can exist without a community."
                : draft.step === "collection"
                  ? "A collection groups terms for a project, event, or review. It can include terms from different vocabularies."
                  : draft.step === "terms"
                    ? `New definitions will be published in ${vocabulary?.title ?? "your selected vocabulary"}${collection ? ` and grouped in ${collection.title}` : ""}.`
                    : "New terms receive their first definition. Existing definitions are kept as they are."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {draft.step === "community" ? (
            <>
              {!directCreate ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="setup-community">
                      Existing community
                    </FieldLabel>
                    <SetupSelect
                      id="setup-community"
                      value={draft.communityId}
                      disabled={busy}
                      onChange={(event) => {
                        const selected = options.communities.find(
                          (item) => String(item.id) === event.target.value
                        )
                        update({
                          communityId: event.target.value,
                          vocabularySlug:
                            selected?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG,
                          collectionId: ""
                        })
                      }}
                    >
                      <option value="">Continue without a community</option>
                      {draft.communityId && !community ? (
                        <option value={draft.communityId} disabled>
                          Unavailable community — choose another
                        </option>
                      ) : null}
                      {options.communities.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          disabled={!item.canContribute}
                        >
                          {item.title}
                          {!item.canContribute ? " — membership required" : ""}
                        </option>
                      ))}
                    </SetupSelect>
                    <FieldDescription>
                      You can use the general vocabulary or choose a standalone
                      vocabulary in the next step.
                    </FieldDescription>
                  </Field>
                  <div>
                    <Button
                      disabled={
                        busy ||
                        Boolean(draft.communityId && !community?.canContribute)
                      }
                      onClick={() => go("vocabulary")}
                    >
                      Continue
                      <ArrowRightIcon aria-hidden data-icon="inline-end" />
                    </Button>
                  </div>
                </FieldGroup>
              ) : null}
              {options.canCreateCommunity ? (
                <CreationSection
                  direct={directCreate}
                  label="Create a new community"
                >
                  <EntityForm
                    kind="community"
                    value={draft.community}
                    disabled={busy}
                    onChange={(value) => update({ community: value })}
                    submitLabel={
                      directCreate
                        ? "Create community"
                        : "Create community and continue"
                    }
                    onSubmit={() =>
                      perform(async () => {
                        await createSafely(
                          "community",
                          draft.community.title,
                          () => createCommunity.mutateAsync(draft.community),
                          (created) => ({
                            communityId: String(created.id),
                            vocabularySlug: created.slug,
                            collectionId: "",
                            ...(directCreate
                              ? {
                                  receipt: {
                                    title: "Community created",
                                    href: communityPath(created.slug),
                                    detail:
                                      "Your community and its vocabulary are ready. Invite people from the community page."
                                  }
                                }
                              : {
                                  step: "vocabulary",
                                  furthest: Math.max(
                                    draft.furthest,
                                    setupSteps.indexOf("vocabulary")
                                  )
                                })
                          })
                        )
                        await optionsQuery.refetch()
                        if (!directCreate) {
                          setNotice(
                            "Community and vocabulary created. You can now add terms."
                          )
                        }
                      })
                    }
                  />
                </CreationSection>
              ) : (
                <p className="text-sm text-muted-foreground">
                  A site administrator creates communities.{" "}
                  {directCreate ? (
                    <Link href="/setup" className="underline">
                      Continue with an existing community or vocabulary.
                    </Link>
                  ) : (
                    "Choose an existing community above, or continue without one."
                  )}
                </p>
              )}
            </>
          ) : null}

          {draft.step === "vocabulary" ? (
            <>
              {!directCreate ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="setup-vocabulary">
                      Vocabulary for your terms
                    </FieldLabel>
                    <SetupSelect
                      id="setup-vocabulary"
                      value={draft.vocabularySlug}
                      disabled={busy}
                      onChange={(event) => selectVocabulary(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose a vocabulary
                      </option>
                      {draft.vocabularySlug && !vocabulary ? (
                        <option value={draft.vocabularySlug} disabled>
                          Unavailable vocabulary — choose another
                        </option>
                      ) : null}
                      {options.vocabularies.map((item) => (
                        <option
                          key={item.slug}
                          value={item.slug}
                          disabled={!item.canContribute}
                        >
                          {item.title}
                          {item.communityId ? " — community vocabulary" : ""}
                          {!item.canContribute ? " — unavailable" : ""}
                        </option>
                      ))}
                    </SetupSelect>
                    <FieldDescription>
                      {community
                        ? `Owned by ${community.title}.`
                        : "This vocabulary is independent of a community."}{" "}
                      Choosing a destination here keeps your working community
                      elsewhere unchanged.
                    </FieldDescription>
                  </Field>
                  <StepActions
                    back={task === "import" ? undefined : () => go("community")}
                    busy={busy}
                    onNext={() => go("collection")}
                    disabled={!vocabulary?.canContribute}
                  />
                </FieldGroup>
              ) : null}
              {options.canCreateVocabulary ? (
                <CreationSection
                  direct={directCreate}
                  label="Create a standalone vocabulary"
                >
                  <p className="text-sm text-muted-foreground">
                    This creates a separate named vocabulary. Each community
                    already has its own vocabulary.
                  </p>
                  <EntityForm
                    kind="vocabulary"
                    value={draft.vocabulary}
                    disabled={busy}
                    onChange={(value) => update({ vocabulary: value })}
                    submitLabel={
                      directCreate
                        ? "Create vocabulary"
                        : "Create vocabulary and continue"
                    }
                    onSubmit={() =>
                      perform(async () => {
                        await createSafely(
                          "vocabulary",
                          draft.vocabulary.title,
                          () => createVocabulary.mutateAsync(draft.vocabulary),
                          (created) => ({
                            vocabularySlug: created.slug,
                            communityId: "",
                            collectionId: "",
                            ...(directCreate
                              ? {
                                  receipt: {
                                    title: "Vocabulary created",
                                    href: vocabularyPath(created.slug),
                                    detail:
                                      "Your named vocabulary is ready for terms and definitions."
                                  }
                                }
                              : {
                                  step: "collection",
                                  furthest: Math.max(
                                    draft.furthest,
                                    setupSteps.indexOf("collection")
                                  )
                                })
                          })
                        )
                        await optionsQuery.refetch()
                        if (!directCreate) {
                          setNotice("Standalone vocabulary created.")
                        }
                      })
                    }
                  />
                </CreationSection>
              ) : (
                <p className="text-sm text-muted-foreground">
                  A site administrator creates named vocabularies.{" "}
                  {directCreate ? (
                    <Link className="underline" href="/setup?task=import">
                      Choose an existing vocabulary to contribute terms.
                    </Link>
                  ) : (
                    "You can contribute to the available vocabularies above."
                  )}
                </p>
              )}
            </>
          ) : null}

          {draft.step === "collection" ? (
            <>
              {!directCreate ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="setup-collection">
                      Group these terms in a collection
                    </FieldLabel>
                    <SetupSelect
                      id="setup-collection"
                      value={draft.collectionId}
                      disabled={busy}
                      onChange={(event) =>
                        update({ collectionId: event.target.value })
                      }
                    >
                      <option value="">No collection — skip this step</option>
                      {draft.collectionId && !collection ? (
                        <option value={draft.collectionId} disabled>
                          Unavailable collection — choose another or skip
                        </option>
                      ) : null}
                      {options.collections.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </SetupSelect>
                    <FieldDescription>
                      Only collections you can add terms to are listed. Terms
                      retain the identity of their vocabulary.
                    </FieldDescription>
                  </Field>
                  <StepActions
                    back={() => go("vocabulary")}
                    busy={busy}
                    disabled={Boolean(draft.collectionId && !collection)}
                    onNext={() =>
                      perform(async () => {
                        if (
                          collection &&
                          community?.canManageWorklist &&
                          !collection.communityIds.includes(community.id)
                        ) {
                          await attachCollection.mutateAsync({
                            communityId: community.id,
                            collectionId: collection.id,
                            on: true
                          })
                          await optionsQuery.refetch()
                          setNotice(
                            "Collection added to the community worklist."
                          )
                        }
                        go("terms")
                      })
                    }
                    label={
                      draft.collectionId
                        ? community?.canManageWorklist &&
                          !collection?.communityIds.includes(community.id)
                          ? "Add to worklist and continue"
                          : "Use collection"
                        : "Skip collection"
                    }
                  />
                </FieldGroup>
              ) : null}
              {options.canCreateCollection || community?.canManageWorklist ? (
                <CreationSection
                  direct={directCreate}
                  label="Create a new collection"
                >
                  {community?.canManageWorklist ? (
                    <p className="text-sm text-muted-foreground">
                      The collection will be added to {community.title}&apos;s
                      worklist.
                    </p>
                  ) : null}
                  <EntityForm
                    kind="collection"
                    value={draft.collection}
                    disabled={busy}
                    onChange={(value) => update({ collection: value })}
                    submitLabel={
                      directCreate
                        ? "Create collection"
                        : "Create collection and continue"
                    }
                    onSubmit={() =>
                      perform(async () => {
                        await createSafely(
                          "collection",
                          draft.collection.title,
                          () =>
                            community?.canManageWorklist
                              ? createWorklist.mutateAsync({
                                  ...draft.collection,
                                  communityId: community.id
                                })
                              : createCollection.mutateAsync(draft.collection),
                          (created) => ({
                            collectionId: String(created.id),
                            ...(directCreate
                              ? {
                                  receipt: {
                                    title: "Collection created",
                                    href: collectionPath(created.slug),
                                    detail:
                                      "Select terms from any vocabulary on the collection page."
                                  }
                                }
                              : {
                                  step: "terms",
                                  furthest: Math.max(
                                    draft.furthest,
                                    setupSteps.indexOf("terms")
                                  )
                                })
                          })
                        )
                        await optionsQuery.refetch()
                        if (!directCreate) {
                          setNotice(
                            "Collection created. Choose which terms to add next."
                          )
                        }
                      })
                    }
                  />
                </CreationSection>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Collection creation is available to site administrators and
                  community stewards, or when enabled for contributors.{" "}
                  {directCreate ? (
                    <Link className="underline" href="/collections">
                      Browse existing collections.
                    </Link>
                  ) : (
                    "You can skip this step."
                  )}
                </p>
              )}
            </>
          ) : null}

          {draft.step === "terms" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void reviewTerms()
              }}
            >
              <FieldGroup>
                {task !== "import" ? (
                  <FieldSet>
                    <FieldLegend>How would you like to add terms?</FieldLegend>
                    <div className="flex flex-wrap gap-5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="setup-mode"
                          value="single"
                          checked={draft.mode === "single"}
                          disabled={busy}
                          onChange={() => update({ mode: "single" })}
                        />
                        Write one term
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="setup-mode"
                          value="import"
                          checked={draft.mode === "import"}
                          disabled={busy}
                          onChange={() =>
                            void perform(async () => {
                              await singleTermEditor.current?.flush()
                              update({ mode: "import" })
                            })
                          }
                        />
                        Import a batch
                      </label>
                    </div>
                  </FieldSet>
                ) : null}
                {draft.mode === "single" ? (
                  <SetupTermDraftFields
                    ownerId={initialOptions.userId!}
                    draft={draft}
                    busy={busy}
                    returnTo={returnTo}
                    controllerRef={singleTermEditor}
                    perform={perform}
                    onEdit={(patch) => update(patch)}
                    onSaved={(saved) =>
                      setDraft((current) =>
                        current.termDraftId === saved.id
                          ? current
                          : { ...current, termDraftId: saved.id }
                      )
                    }
                    onRestore={(saved) => {
                      if (saved.publication) {
                        const published = saved.publication
                        finish(
                          "Term published",
                          definitionPath(
                            published.term.slug,
                            published.definition.definitionNumber,
                            published.term.vocabularySlug
                          ),
                          "Your term and its first definition are published."
                        )
                        return
                      }
                      const destination = options.vocabularies.find(
                        (item) => item.slug === saved.payload.vocabularySlug
                      )
                      setDraft((current) => ({
                        ...current,
                        term: saved.payload.term,
                        definition: saved.payload.definition,
                        termDraftId: saved.id,
                        vocabularySlug:
                          saved.payload.vocabularySlug ??
                          current.vocabularySlug,
                        communityId: destination?.communityId
                          ? String(destination.communityId)
                          : "",
                        collectionId: saved.payload.collectionId
                          ? String(saved.payload.collectionId)
                          : "",
                        termDraftDestinationChanged: false
                      }))
                    }}
                  />
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor="setup-file">
                        Choose a CSV or TSV file (optional)
                      </FieldLabel>
                      <Input
                        id="setup-file"
                        type="file"
                        accept=".csv,.tsv,text/csv,text/tab-separated-values"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (!file) return
                          void perform(async () => {
                            if (file.size > 1000000)
                              throw new Error(
                                "Choose a file smaller than 1 MB."
                              )
                            update({
                              text: await file.text(),
                              format: file.name.toLowerCase().endsWith(".tsv")
                                ? "tsv"
                                : "csv"
                            })
                          })
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="setup-format">Format</FieldLabel>
                      <SetupSelect
                        id="setup-format"
                        value={draft.format}
                        disabled={busy}
                        onChange={(event) =>
                          update({
                            format: event.target.value as "csv" | "tsv"
                          })
                        }
                      >
                        <option value="csv">CSV — comma separated</option>
                        <option value="tsv">TSV — tab separated</option>
                      </SetupSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="setup-import">
                        Terms and definitions
                      </FieldLabel>
                      <Textarea
                        id="setup-import"
                        required
                        value={draft.text}
                        disabled={busy}
                        maxLength={1000000}
                        rows={8}
                        spellCheck={false}
                        onChange={(event) =>
                          update({ text: event.target.value })
                        }
                        placeholder={
                          'term,definition\ngrain boundary,"An interface between adjacent crystals."'
                        }
                      />
                      <FieldDescription>
                        Start with a <code>term,definition</code> header (or the
                        same columns separated by a tab). New terms need a
                        definition. Existing terms can leave it blank and will
                        be reused without changes.
                      </FieldDescription>
                    </Field>
                  </>
                )}
                {draft.mode === "import" ? (
                  <p className="text-sm text-muted-foreground">
                    Preview up to {options.importLimits.maxRows} rows. Your
                    account can publish up to{" "}
                    {options.importLimits.newDefinitionsPerWindow} new
                    definitions in {options.importLimits.windowMinutes} minutes;
                    reusing existing terms does not use this allowance.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => go("collection")}
                  >
                    <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      !options.profileComplete ||
                      !vocabulary?.canContribute
                    }
                  >
                    {busy
                      ? "Checking terms…"
                      : draft.mode === "single"
                        ? "Review term"
                        : "Preview terms"}
                    <ArrowRightIcon aria-hidden data-icon="inline-end" />
                  </Button>
                </div>
              </FieldGroup>
            </form>
          ) : null}

          {draft.step === "review" &&
          draft.mode === "single" &&
          draft.termDraftId ? (
            <DefinitionForm
              ownerId={initialOptions.userId!}
              draftId={draft.termDraftId}
              reviewOnLoad
              onDraftController={(controller) => {
                singleTermEditor.current = controller
              }}
              onPublished={(published) =>
                finish(
                  "Term published",
                  definitionPath(
                    published.term.slug,
                    published.definition.definitionNumber,
                    published.term.vocabularySlug
                  ),
                  `Your term and its first definition are published${collection ? ` and included in ${collection.title}` : ""}.`
                )
              }
              onBusyChange={setLocalBusy}
            />
          ) : null}

          {draft.step === "review" && draft.mode === "import" && preview ? (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Vocabulary</dt>
                  <dd className="font-medium">
                    {vocabulary?.title ?? draft.vocabularySlug}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Collection</dt>
                  <dd className="font-medium">
                    {collection?.title ?? "No collection"}
                  </dd>
                </div>
              </dl>
              <p role="status" className="text-sm">
                {preview.newCount} new · {preview.reuseCount} existing ·{" "}
                {preview.duplicateCount} duplicate rows skipped
              </p>
              {preview.errors.length ? (
                <Alert variant="destructive">
                  <AlertTitle>Resolve these issues before importing</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {preview.errors.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <ul className="flex flex-col divide-y">
                {preview.rows.map((row, index) => (
                  <li
                    key={index}
                    className="flex min-w-0 flex-col gap-2 py-4 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium [overflow-wrap:anywhere]">
                        {row.term || `Row ${row.line}`}
                      </span>
                      <Badge
                        variant={
                          row.action === "error" ? "destructive" : "secondary"
                        }
                      >
                        {row.action === "create"
                          ? "New term"
                          : row.action === "reuse"
                            ? "Use existing"
                            : row.action === "duplicate"
                              ? "Skip duplicate"
                              : "Needs attention"}
                      </Badge>
                    </div>
                    {row.action === "create" ? (
                      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                        {row.definition}
                      </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {row.message}
                    </p>
                    {row.termSlug ? (
                      <Link
                        className="w-fit text-sm text-primary underline"
                        href={termPath(row.termSlug, draft.vocabularySlug)}
                      >
                        View existing term
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Separator />
              <p className="text-sm text-muted-foreground">
                Publishing makes new terms and definitions public, attributed to
                your account
                {collection
                  ? ", and adds the selected terms to the collection"
                  : ""}
                .
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => go("terms")}
                >
                  <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                  Edit terms
                </Button>
                <Button
                  disabled={
                    busy || !preview.canImport || !vocabulary?.canContribute
                  }
                  onClick={() =>
                    perform(async () => {
                      const result = await importTerms.mutateAsync({
                        ...inputForImport(),
                        previewToken: preview.previewToken
                      })
                      finish(
                        "Terms ready",
                        vocabularyPath(result.vocabularySlug),
                        `${result.created} new terms published; ${result.reused} existing terms reused.${result.collectionAdded ? ` ${result.collectionAdded} terms added to the collection.` : ""}`
                      )
                    })
                  }
                >
                  {busy ? "Publishing…" : "Import terms"}
                  <CheckIcon aria-hidden data-icon="inline-end" />
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          {directCreate
            ? "Creating a community, vocabulary, or collection saves it to MatSci-SAM immediately."
            : "Single-term drafts save privately to your account. Setup choices and unfinished imports stay in this browser on this device. Communities, vocabularies, and collections save when you create them."}
        </p>
        <Link href="/docs/communities" className="underline">
          How these fit together
        </Link>
      </div>
      {!browserStorageAvailable ? (
        <p role="alert" className="text-sm text-destructive">
          Your setup choices cannot be saved on this device. Keep this page open
          until you are finished. Single-term drafts can still save to your
          account.
        </p>
      ) : null}
    </>
  )
}

function SetupTermDraftFields({
  ownerId,
  draft,
  busy,
  returnTo,
  controllerRef,
  perform,
  onEdit,
  onSaved,
  onRestore
}: {
  ownerId: number
  draft: SetupDraft
  busy: boolean
  returnTo: string
  controllerRef: RefObject<TermDraftController | null>
  perform: (work: () => Promise<void>) => Promise<void>
  onEdit: (patch: Partial<SetupDraft>) => void
  onSaved: (saved: SavedTermDraft) => void
  onRestore: (saved: SavedTermDraft) => void
}) {
  const router = useRouter()
  const [destinationNotice, setDestinationNotice] = useState("")
  const saved = useTermDraft({
    ownerId,
    draftId: draft.termDraftId ?? undefined,
    initialPayload: {
      ...emptyTermDraftPayload(draft.vocabularySlug),
      term: draft.term,
      definition: draft.definition,
      collectionId: draft.collectionId ? Number(draft.collectionId) : null
    },
    onSaved,
    onRestore: (record) => {
      if (draft.termDraftDestinationChanged && record.status === "draft") {
        const keepVocabulary =
          record.payload.vocabularySlug !== draft.vocabularySlug &&
          termDraftHasEvidence(record.payload)
        if (keepVocabulary)
          setDestinationNotice(
            "This draft includes sources or AI assistance for its current vocabulary. Use the full editor to change the term or its evidence before choosing another vocabulary."
          )
        const payload = {
          ...record.payload,
          vocabularySlug: keepVocabulary
            ? record.payload.vocabularySlug
            : draft.vocabularySlug,
          collectionId: draft.collectionId ? Number(draft.collectionId) : null
        }
        saved.setPayload(payload)
        onRestore({ ...record, payload })
      } else onRestore(record)
    }
  })
  useEffect(() => {
    controllerRef.current = saved
    return () => {
      controllerRef.current = null
    }
  }, [controllerRef, saved])
  const disabled =
    busy ||
    saved.loading ||
    !!saved.loadError ||
    saved.record?.status === "published"
  return (
    <>
      <DraftSaveStatus draft={saved} />
      {destinationNotice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {destinationNotice}
        </p>
      ) : null}
      <Field>
        <FieldLabel htmlFor="setup-term">Term</FieldLabel>
        <Input
          id="setup-term"
          value={saved.payload.term}
          required
          disabled={disabled}
          readOnly={termDraftHasEvidence(saved.payload)}
          maxLength={TERM_MAX_LENGTH}
          placeholder="For example, grain boundary"
          onChange={(event) => {
            const term = event.target.value
            if (!termDraftHasEvidence(saved.payload)) {
              saved.setPayload((current) => changeSetupTerm(current, term))
              onEdit({ term })
            }
          }}
        />
        {termDraftHasEvidence(saved.payload) ? (
          <FieldDescription>
            Use the full editor to change this term and review its sources or AI
            assistance.
          </FieldDescription>
        ) : null}
      </Field>
      <Field>
        <FieldLabel htmlFor="setup-definition">First definition</FieldLabel>
        <Textarea
          id="setup-definition"
          value={saved.payload.definition}
          required
          disabled={disabled}
          maxLength={DEFINITION_MAX_LENGTH}
          rows={5}
          placeholder="Explain what this term means."
          onChange={(event) => {
            const definition = event.target.value
            saved.setPayload((current) => ({ ...current, definition }))
            onEdit({ definition })
          }}
        />
        <FieldDescription>
          <button
            type="button"
            className="underline"
            disabled={disabled}
            onClick={() =>
              void perform(async () => {
                const record = await saved.flush()
                if (!record)
                  throw new Error(
                    "Enter a term before opening the full editor."
                  )
                const back = new URL(returnTo, window.location.origin)
                back.searchParams.set("draftId", record.id)
                router.push(
                  `/add?${new URLSearchParams({ draftId: record.id, setupReturnTo: `${back.pathname}${back.search}` })}`
                )
              })
            }
          >
            Open the full term editor
          </button>{" "}
          to add references, examples, or optional AI assistance. The same draft
          is saved in both editors.
        </FieldDescription>
      </Field>
    </>
  )
}

function SetupSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        className
      )}
    />
  )
}

function CreationSection({
  direct,
  label,
  children
}: {
  direct: boolean
  label: string
  children: React.ReactNode
}) {
  if (direct) return <div className="flex flex-col gap-4">{children}</div>
  return (
    <details>
      <summary className="w-fit cursor-pointer text-sm font-medium text-primary">
        {label}
      </summary>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </details>
  )
}

function EntityForm({
  kind,
  value,
  disabled,
  onChange,
  onSubmit,
  submitLabel
}: {
  kind: "community" | "vocabulary" | "collection"
  value: { title: string; description: string }
  disabled: boolean
  onChange: (value: { title: string; description: string }) => void
  onSubmit: () => Promise<void>
  submitLabel: string
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`setup-${kind}-name`}>
            {labels[kind]} name
          </FieldLabel>
          <Input
            id={`setup-${kind}-name`}
            value={value.title}
            required
            maxLength={120}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, title: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`setup-${kind}-description`}>
            Description (optional)
          </FieldLabel>
          <Textarea
            id={`setup-${kind}-description`}
            value={value.description}
            maxLength={2000}
            rows={3}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, description: event.target.value })
            }
          />
        </Field>
        <div>
          <Button type="submit" disabled={disabled || !value.title.trim()}>
            {disabled ? "Saving…" : submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}

function StepActions({
  back,
  onNext,
  busy,
  disabled,
  label = "Continue"
}: {
  back?: () => void
  onNext: () => void
  busy: boolean
  disabled?: boolean
  label?: string
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {back ? (
        <Button type="button" variant="outline" disabled={busy} onClick={back}>
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          Back
        </Button>
      ) : null}
      <Button type="button" disabled={busy || disabled} onClick={onNext}>
        {label}
        <ArrowRightIcon aria-hidden data-icon="inline-end" />
      </Button>
    </div>
  )
}
