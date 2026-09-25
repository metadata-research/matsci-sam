"use client"

import { useId, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  buildWolframQuery,
  WOLFRAM_LOOKUP_LIMIT,
  type WolframLookupOptions
} from "@/lib/wolfram-query"
import { parseWolframResult } from "@/lib/wolfram-result-format"
import type { TermReferenceWorkspace } from "./term-reference-workspace"

function LookupSelect({
  label,
  value,
  disabled,
  onChange,
  children
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 truncate rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      >
        {children}
      </select>
    </Field>
  )
}

export function WolframLookupOptionsForm({
  workspace,
  disabled
}: {
  workspace: TermReferenceWorkspace
  disabled: boolean
}) {
  const id = useId()
  const state = workspace.providers.wolfram
  const { result, options } = state
  const editing = !result || state.editing
  const input = buildWolframQuery(workspace.term, state.context)
  const canRefine = state.history.length < WOLFRAM_LOOKUP_LIMIT
  const alternatives =
    result?.references.flatMap(
      (reference) => parseWolframResult(reference.definition).alternatives
    ) ?? []
  const sameInput = result?.request?.input === input
  const change = (patch: Partial<WolframLookupOptions>) =>
    workspace.setWolframOptions({ ...options, assumptions: [], ...patch })

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {editing ? (
        <>
          <FieldGroup>
            <LookupSelect
              label="Preferred units"
              value={options.units}
              disabled={disabled}
              onChange={(units) =>
                workspace.setWolframOptions({
                  ...options,
                  units: units as WolframLookupOptions["units"]
                })
              }
            >
              <option value="metric">Metric</option>
              <option value="nonmetric">US customary</option>
            </LookupSelect>
            <Field>
              <FieldLabel htmlFor={`${id}-context`}>
                Context for Wolfram (optional)
              </FieldLabel>
              <Textarea
                id={`${id}-context`}
                maxLength={1000}
                value={state.context}
                disabled={disabled}
                placeholder="For example: thermal treatment of steel"
                onChange={(event) => {
                  workspace.setWolframContext(event.target.value)
                  change({})
                }}
              />
            </Field>
            {sameInput &&
              (alternatives.length > 0 || options.assumptions.length > 0) && (
                <LookupSelect
                  label="Wolfram interpretation"
                  value={options.assumptions[0] ?? ""}
                  disabled={disabled}
                  onChange={(value) =>
                    change({ assumptions: value ? [value] : [] })
                  }
                >
                  <option value="">Automatic interpretation</option>
                  {options.assumptions[0] &&
                    !alternatives.some(
                      (item) => item.value === options.assumptions[0]
                    ) && (
                      <option value={options.assumptions[0]}>
                        Previously selected interpretation
                      </option>
                    )}
                  {alternatives.map((alternative) => (
                    <option key={alternative.value} value={alternative.value}>
                      {alternative.label}
                    </option>
                  ))}
                </LookupSelect>
              )}
          </FieldGroup>
          <p className="text-xs text-muted-foreground">
            Wolfram interprets the query automatically unless you choose one of
            its returned alternatives. Context is a hint, not a filter. Only
            this query and the selected options are sent. Your definition stays
            here.
          </p>
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="font-medium">Query to send</p>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {input}
            </p>
            {options.assumptions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Interpretation:{" "}
                {alternatives.find(
                  (item) => item.value === options.assumptions[0]
                )?.label ?? "Selected Wolfram interpretation"}
              </p>
            )}
          </div>
          {result && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={workspace.cancelWolframRefinement}
            >
              Cancel refinement
            </Button>
          )}
        </>
      ) : (
        <>
          {result.request && (
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="font-medium">Query used</p>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {result.request.input}
              </p>
              <p className="text-xs text-muted-foreground">
                Preferred units:{" "}
                {result.request.options.units === "metric"
                  ? "Metric"
                  : "US customary"}
              </p>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !canRefine}
            onClick={workspace.refineWolfram}
          >
            Refine lookup
          </Button>
          {!canRefine && (
            <p className="text-xs text-muted-foreground">
              Five lookups saved for this term. You can still use and review any
              saved result.
            </p>
          )}
        </>
      )}
      {state.history.length > 1 && !state.editing && (
        <LookupSelect
          label="Saved Wolfram lookup"
          value={result?.lookupId ?? ""}
          disabled={disabled}
          onChange={workspace.viewWolframLookup}
        >
          {state.history.map((lookup, index) => (
            <option key={lookup.lookupId} value={lookup.lookupId}>
              Lookup {index + 1}: {lookup.request?.input ?? workspace.term}
              {lookup.request?.options.assumptions.length
                ? " · selected interpretation"
                : ""}
            </option>
          ))}
        </LookupSelect>
      )}
    </div>
  )
}
