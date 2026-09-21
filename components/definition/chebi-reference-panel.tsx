"use client"

import { referenceText } from "@/lib/reference-text"
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState
} from "react"
import {
  BookOpenIcon,
  CopyIcon,
  PlusIcon,
  LoaderCircleIcon
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FieldSet, FieldLegend } from "@/components/ui/field"
import { WolframResult } from "./wolfram-result"
import { WolframLookupOptionsForm } from "./wolfram-lookup-options"
import { type ReferenceProvider } from "@/lib/reference-types"
import {
  useTermReferenceWorkspace,
  referenceLookups,
  type DraftReferenceSelection,
  type ReferenceProviderState,
  type TermReferenceWorkspace
} from "./term-reference-workspace"

export {
  useTermReferenceWorkspace,
  selectedModelReferenceIds,
  selectedRevisionReferences,
  type DraftReferenceSelection,
  type TermReferenceWorkspace
} from "./term-reference-workspace"

const providerName = (provider: ReferenceProvider) =>
  provider === "chebi" ? "ChEBI" : "Wolfram"

function providerStatus(
  provider: ReferenceProvider,
  state: ReferenceProviderState
) {
  const name = providerName(provider)
  if (state.actionError)
    return `${name}: copy/add activity could not be recorded`
  if (state.status === "pending")
    return `Finding ${name} ${provider === "chebi" ? "definitions" : "resources"}…`
  if (state.status === "error") return `${name} lookup needs attention`
  if (state.result) {
    const count = state.result.references.length
    return count
      ? `${name}: ${count} ${provider === "chebi" ? (count === 1 ? "possible match" : "possible matches") : "result ready"}`
      : `${name}: no ${provider === "chebi" ? "definition" : "resources"} found`
  }
  return provider === "chebi"
    ? "ChEBI lookup starts after you confirm the term"
    : "Optional Wolfram lookup"
}

/** Keep this near the active step even while another contextual view is open. */
export function ReferenceStatus({
  workspace,
  onOpen,
  disabled = false
}: {
  workspace: TermReferenceWorkspace
  onOpen: (provider: ReferenceProvider) => void
  disabled?: boolean
}) {
  if (!workspace.enabled) return null
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
      aria-label="Reference lookup status"
    >
      {(["chebi", "wolfram"] as const).map((provider) => (
        <div
          key={provider}
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            {providerStatus(provider, workspace.providers[provider])}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onOpen(provider)}
          >
            {provider === "chebi"
              ? "View references"
              : workspace.providers.wolfram.status === "idle"
                ? "Wolfram lookup"
                : "View Wolfram"}
          </Button>
        </div>
      ))}
    </div>
  )
}

export function ReferenceTools({
  workspace,
  provider,
  disabled,
  canAdd,
  onAdd,
  allowModelInputs = false,
  onProviderChange,
  onModelInputAdded,
  visible = true
}: {
  workspace: TermReferenceWorkspace
  provider: ReferenceProvider
  disabled: boolean
  canAdd: boolean
  onAdd: (text: string) => boolean
  allowModelInputs?: boolean
  onBack?: () => void
  onProviderChange: (provider: ReferenceProvider) => void
  onModelInputAdded?: () => void
  visible?: boolean
}) {
  const id = useId()
  const state = workspace.providers[provider]
  const result = provider === "wolfram" && state.editing ? null : state.result
  const name = providerName(provider)
  const providerBusy =
    !workspace.enabled || state.status === "pending" || state.clipboardBusy
  const busy = disabled || providerBusy
  const currentSelection = workspace.selection.find(
    (item) => item.lookupId === result?.lookupId
  )
  // Mounted content can be hidden by a caller; only visible Wolfram results
  // enter the locally consulted shortlist. Retrieval alone never does.
  useEffect(() => {
    if (visible && provider === "wolfram" && result)
      workspace.markConsulted(
        provider,
        result.references.map((reference) => reference.id)
      )
  }, [visible, provider, result, workspace])
  return (
    <Card
      aria-label={`${name} reference resources`}
      className="min-w-0 gap-4 shadow-none"
    >
      <CardHeader>
        {provider === "wolfram" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={disabled}
            onClick={() => onProviderChange("chebi")}
          >
            Back to references
          </Button>
        )}
        <CardTitle className="flex items-center gap-2">
          <BookOpenIcon className="size-4" aria-hidden />
          {provider === "chebi"
            ? "ChEBI references"
            : "Wolfram factual context"}
        </CardTitle>
        <CardDescription>
          {provider === "chebi"
            ? "Check the source meaning before using a definition."
            : "Retrieve facts and interpretations from Wolfram|Alpha. Results are stored for this prototype."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <p className="break-words text-sm">
          Term: <strong>{workspace.term}</strong>
        </p>
        {provider === "wolfram" && (
          <WolframLookupOptionsForm workspace={workspace} disabled={busy} />
        )}
        {state.status === "pending" && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Retrieving {name}… You can return to writing.
          </p>
        )}
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {state.error} You can continue writing without this lookup.
            </AlertDescription>
          </Alert>
        )}
        {!result && state.status !== "pending" && (
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              !workspace.term.trim() ||
              workspace.term.trim().length > 200
            }
            onClick={() => void workspace.retrieve(provider)}
          >
            {state.status === "error"
              ? `Retry ${name} lookup`
              : provider === "chebi"
                ? "Retrieve ChEBI definition"
                : "Retrieve Wolfram resources"}
          </Button>
        )}
        {result && result.references.length === 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            No {name} {provider === "chebi" ? "definition" : "resources"} found
            for “{workspace.term}”. You can continue writing your own
            definition.
          </p>
        )}
        {result && result.references.length > 0 && (
          <div
            className="flex min-w-0 flex-col gap-3"
            aria-label={provider === "chebi" ? "Possible matches" : "Results"}
          >
            {result.references
              .slice(0, state.showMore ? undefined : 1)
              .map((reference, index) => {
                const revealed =
                  provider === "wolfram" ||
                  state.revealedReferenceIds.includes(reference.id)
                const inContext =
                  currentSelection?.modelReferenceIds.includes(reference.id) ??
                  false
                const cited =
                  currentSelection?.citedReferenceIds.includes(reference.id) ??
                  false
                const availability = workspace.modelInputAvailability(
                  reference.id
                )
                return (
                  <div
                    key={reference.id}
                    className="flex min-w-0 flex-col gap-3 rounded-md border p-4"
                  >
                    {provider === "chebi" && (
                      <p className="text-xs text-muted-foreground">
                        {index === 0
                          ? "Closest possible match"
                          : "Another possible match"}
                      </p>
                    )}
                    <a
                      href={reference.sourceIri}
                      target="_blank"
                      rel="noreferrer"
                      className="break-words font-medium text-primary underline underline-offset-4"
                    >
                      {reference.term}
                    </a>
                    {provider === "chebi" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        disabled={providerBusy}
                        aria-expanded={revealed}
                        aria-controls={`${id}-${reference.id}-definition`}
                        onClick={() =>
                          workspace.setReferenceRevealed(
                            provider,
                            reference.id,
                            !revealed
                          )
                        }
                      >
                        {revealed ? "Hide definition" : "Show definition"}
                      </Button>
                    )}
                    {revealed && (
                      <div
                        id={`${id}-${reference.id}-definition`}
                        className="flex min-w-0 flex-col gap-3"
                      >
                        {provider === "wolfram" && (
                          <p className="text-xs text-muted-foreground">
                            Saved lookup{" "}
                            {state.history.findIndex(
                              (lookup) => lookup.lookupId === result.lookupId
                            ) + 1}{" "}
                            · Actions apply to this complete response.
                          </p>
                        )}
                        {provider === "wolfram" ? (
                          <div
                            className="max-h-[32rem] min-w-0 overflow-y-auto pr-1"
                            aria-label="Wolfram result content"
                            tabIndex={0}
                          >
                            <WolframResult
                              text={reference.definition}
                              copyDisabled={providerBusy}
                              onCopySection={(text) =>
                                void workspace.copy(
                                  provider,
                                  reference.id,
                                  text
                                )
                              }
                            />
                          </div>
                        ) : (
                          <blockquote className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {referenceText(reference)}
                          </blockquote>
                        )}
                        <p className="break-words text-xs text-muted-foreground">
                          {reference.source}
                          {provider === "chebi"
                            ? ` · ${reference.sourceIri.split("/").pop()?.replace("CHEBI_", "CHEBI:")} · release ${reference.version}`
                            : ` · retrieved ${new Date(result.retrievedAt).toLocaleDateString()}`}{" "}
                          ·{" "}
                          {reference.license === "CC-BY-4.0" ? (
                            <a
                              href="https://creativecommons.org/licenses/by/4.0/"
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              {reference.license}
                            </a>
                          ) : (
                            reference.license ||
                            "Prototype use; long-term terms under discussion"
                          )}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || !canAdd}
                            onClick={() =>
                              workspace.add(provider, reference.id, onAdd)
                            }
                          >
                            <PlusIcon data-icon="inline-start" aria-hidden />
                            Add to definition
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={providerBusy}
                            onClick={() =>
                              void workspace.copy(provider, reference.id)
                            }
                          >
                            <CopyIcon data-icon="inline-start" aria-hidden />
                            Copy
                          </Button>
                        </div>
                        {!canAdd && (
                          <p className="text-xs text-muted-foreground">
                            Return to writing before adding source text.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {allowModelInputs && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={
                                busy || inContext || !availability.allowed
                              }
                              aria-describedby={
                                !availability.allowed
                                  ? `${id}-${reference.id}-limit`
                                  : undefined
                              }
                              onClick={() => {
                                if (
                                  workspace.addModelInput(
                                    provider,
                                    reference.id
                                  )
                                )
                                  onModelInputAdded?.()
                              }}
                            >
                              {inContext
                                ? "In assistant context"
                                : "Add to assistant context"}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy || cited}
                            onClick={() =>
                              workspace.changeSelection(
                                provider,
                                reference.id,
                                "citedReferenceIds",
                                true
                              )
                            }
                          >
                            {cited
                              ? "Citation attached"
                              : "Cite without inserting"}
                          </Button>
                        </div>
                        {allowModelInputs && !availability.allowed && (
                          <p
                            id={`${id}-${reference.id}-limit`}
                            className="text-xs text-muted-foreground"
                          >
                            {availability.reason}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            {!state.showMore && result.references.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => workspace.showAll(provider)}
              >
                Other matches ({result.references.length - 1})
              </Button>
            )}
          </div>
        )}
        {state.notice && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            {state.notice}
          </p>
        )}
        {state.actionError && (
          <Alert variant="destructive">
            <AlertDescription>
              The copy/add interaction could not be recorded. Your writing and
              source choices remain available.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Add to definition attaches a removable citation. Viewing and copying do
        not attach citations or add assistant context.
      </CardFooter>
    </Card>
  )
}

/** Attached citations are declarations, separate from locally consulted sources. */
export function ReferenceCitations({
  workspace,
  disabled
}: {
  workspace: TermReferenceWorkspace
  disabled: boolean
}) {
  const id = useId()
  const heading = useRef<HTMLLegendElement>(null)
  const references = (["chebi", "wolfram"] as const).flatMap((provider) =>
    referenceLookups(workspace.providers[provider]).flatMap((result, index) =>
      result.references.map((reference) => ({
        provider,
        result,
        reference,
        lookupNumber: index + 1,
        consulted: workspace.providers[provider].consultedReferenceIds.includes(
          reference.id
        ),
        cited:
          workspace.selection
            .find((item) => item.lookupId === result.lookupId)
            ?.citedReferenceIds.includes(reference.id) ?? false
      }))
    )
  )
  // Snapshot the deliberate shortlist. A late lookup or reveal cannot insert
  // new interactive rows under the contributor's pointer while it is open.
  const [pickerIds, setPickerIds] = useState<string[] | null>(null)
  const attached = references.filter((item) => item.cited)
  const candidates = references.filter((item) => item.consulted && !item.cited)
  const listed = references.filter((item) =>
    pickerIds?.includes(item.reference.id)
  )
  const hasNewSources =
    !!pickerIds &&
    candidates.some((item) => !pickerIds.includes(item.reference.id))
  const busy = disabled || !workspace.enabled
  const sourceDetails = ({
    provider,
    result,
    reference,
    lookupNumber
  }: (typeof references)[number]) => (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="break-words text-sm font-medium">
        {reference.source}: {reference.term}
        {provider === "wolfram"
          ? ` · lookup ${lookupNumber}`
          : ` · release ${reference.version}`}
      </p>
      {provider === "wolfram" && result.request && (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {result.request.input}
          {result.request.options.assumptions.length
            ? " · selected Wolfram interpretation"
            : ""}
        </p>
      )}
      <a
        href={reference.sourceIri}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted-foreground underline"
      >
        View publisher source
      </a>
    </div>
  )
  return (
    <FieldSet className="min-w-0">
      <FieldLegend ref={heading} tabIndex={-1}>
        Citations already attached
      </FieldLegend>
      <p className="text-sm text-muted-foreground">
        Keep the citations for sources you used in this definition. Sources sent
        to an assistant are recorded separately.
      </p>
      {!attached.length && (
        <p className="text-sm text-muted-foreground">No citations attached.</p>
      )}
      {attached.map((item) => (
        <div
          key={item.reference.id}
          className="flex min-w-0 flex-col gap-2 rounded-md border p-3"
        >
          {sourceDetails(item)}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={busy}
            aria-label={`Remove citation: ${item.reference.term}`}
            onClick={() => {
              workspace.changeSelection(
                item.provider,
                item.reference.id,
                "citedReferenceIds",
                false
              )
              requestAnimationFrame(() =>
                heading.current?.focus({ preventScroll: true })
              )
            }}
          >
            Remove citation
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        aria-expanded={pickerIds !== null}
        aria-controls={`${id}-citation-picker`}
        onClick={() =>
          setPickerIds((prior) =>
            prior === null ? candidates.map((item) => item.reference.id) : null
          )
        }
      >
        {pickerIds === null ? "Add a citation" : "Close citation list"}
      </Button>
      {pickerIds !== null && (
        <div
          id={`${id}-citation-picker`}
          className="flex min-w-0 flex-col gap-3 rounded-md border p-3"
        >
          <p className="text-sm text-muted-foreground">
            Cite a reference you have opened. Viewing a source alone does not
            claim you used it.
          </p>
          {!listed.length && (
            <p className="text-sm text-muted-foreground">
              No additional opened references. Open a ChEBI definition or a
              Wolfram result to make it available here.
            </p>
          )}
          {listed.map((item) => (
            <div
              key={item.reference.id}
              className="flex min-w-0 flex-col gap-2"
            >
              {sourceDetails(item)}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busy || item.cited}
                aria-label={
                  item.cited
                    ? `Citation attached: ${item.reference.term}`
                    : `Cite ${item.reference.term}`
                }
                onClick={() =>
                  workspace.changeSelection(
                    item.provider,
                    item.reference.id,
                    "citedReferenceIds",
                    true
                  )
                }
              >
                {item.cited ? "Citation attached" : "Cite"}
              </Button>
            </div>
          ))}
          {hasNewSources && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                setPickerIds((prior) => [
                  ...new Set([
                    ...(prior ?? []),
                    ...candidates.map((item) => item.reference.id)
                  ])
                ])
              }
            >
              Review newly opened sources
            </Button>
          )}
        </div>
      )}
    </FieldSet>
  )
}

/** Compatibility for callers migrating to the owner-level workspace. */
export function TermReferencePanel({
  term,
  disabled,
  allowModelInputs = false,
  canAdd = true,
  selection,
  onAdd,
  onSelectionChange
}: {
  term: string
  disabled: boolean
  allowModelInputs?: boolean
  canAdd?: boolean
  selection: DraftReferenceSelection[]
  onAdd: (text: string) => boolean
  onSelectionChange: Dispatch<SetStateAction<DraftReferenceSelection[]>>
}) {
  const [provider, setProvider] = useState<ReferenceProvider>("chebi")
  const workspace = useTermReferenceWorkspace({
    term,
    contextKey: term,
    enabled: !!term.trim(),
    selection,
    onSelectionChange
  })
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ReferenceStatus
        workspace={workspace}
        onOpen={setProvider}
        disabled={disabled}
      />
      <ReferenceTools
        workspace={workspace}
        provider={provider}
        disabled={disabled}
        canAdd={canAdd}
        onAdd={onAdd}
        allowModelInputs={allowModelInputs}
        onBack={() => setProvider("chebi")}
        onProviderChange={setProvider}
      />
      <ReferenceCitations workspace={workspace} disabled={disabled} />
    </div>
  )
}
