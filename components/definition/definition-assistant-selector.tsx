"use client"

import { useId, useState } from "react"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

type AssistantProfile = "default" | "agent-one"

/** Explicit choices override preferences; a stale choice never silently falls back. */
export function useDefinitionAssistant({
  enabled = true,
  study = false
}: { enabled?: boolean; study?: boolean } = {}) {
  const [choice, setChoice] = useState<AssistantProfile | null>(null)
  const utils = trpc.useUtils()
  const catalog = trpc.definitionAssistants.catalog.useQuery(undefined, {
    enabled,
    staleTime: 30000
  })
  const preference = trpc.definitionAssistants.setPreference.useMutation({
    onSuccess: () => void utils.definitionAssistants.catalog.invalidate()
  })
  const profile: AssistantProfile = study
    ? "default"
    : (choice ??
      catalog.data?.preferredProfile ??
      catalog.data?.defaultProfile ??
      "default")
  const selected = catalog.data?.profiles.find((item) => item.id === profile)
  return {
    profile,
    label: selected?.label ?? "Definition assistant",
    available: !!selected?.available && !catalog.isError,
    selected,
    catalog,
    preference,
    study,
    choose: (next: AssistantProfile) => {
      if (
        study ||
        !catalog.data?.profiles.find((item) => item.id === next)?.available
      )
        return
      setChoice(next)
      preference.mutate({ profile: next })
    }
  }
}

export function DefinitionAssistantSelector({
  assistant,
  disabled = false
}: {
  assistant: ReturnType<typeof useDefinitionAssistant>
  disabled?: boolean
}) {
  const id = useId()
  const { catalog, preference, selected } = assistant
  return (
    <Field className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>Definition assistant</FieldLabel>
        <select
          id={id}
          className="min-h-9 max-w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={assistant.profile}
          disabled={
            disabled ||
            assistant.study ||
            catalog.isPending ||
            catalog.isError ||
            preference.isPending
          }
          onChange={(event) =>
            assistant.choose(event.target.value as AssistantProfile)
          }
        >
          {catalog.data?.profiles.map((profile) => (
            <option
              key={profile.id}
              value={profile.id}
              disabled={!profile.available}
            >
              {profile.label}
              {!profile.available ? " — unavailable" : ""}
            </option>
          )) ?? <option value="default">Loading assistants…</option>}
        </select>
      </div>
      {assistant.study && (
        <FieldDescription>
          The assistant is fixed for this study.
        </FieldDescription>
      )}
      {selected && !selected.available && (
        <p role="alert" className="text-sm text-destructive">
          {selected.reason}
        </p>
      )}
      {catalog.data?.profiles
        .filter(
          (profile) => !profile.available && profile.id !== assistant.profile
        )
        .map((profile) => (
          <FieldDescription key={profile.id}>
            {profile.label}: {profile.reason}
          </FieldDescription>
        ))}
      {catalog.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          Assistant availability could not be loaded.
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {preference.isError && (
        <p role="status" className="text-xs text-muted-foreground">
          This choice applies to your request, but your preference could not be
          saved.
        </p>
      )}
    </Field>
  )
}
