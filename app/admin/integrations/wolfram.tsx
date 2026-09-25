"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import type { AssistantProfile } from "@/lib/llm/assistant-profiles"
import { trpc } from "@/trpc/client"
import {
  CheckCircle2Icon,
  CircleOffIcon,
  SunIcon,
  TriangleAlertIcon
} from "lucide-react"
import { cn } from "@/lib/utils"
import styles from "../admin.module.css"

type DraftSettings = {
  agentOneEnabled: boolean
  defaultProfile: AssistantProfile
}

export const WolframCard = () => {
  const id = useId()
  const utils = trpc.useUtils()
  const [settings] = trpc.definitionAssistants.settings.useSuspenseQuery()
  const [draft, setDraft] = useState<DraftSettings | null>(null)
  const refresh = () =>
    Promise.all([
      utils.definitionAssistants.settings.invalidate(),
      utils.definitionAssistants.catalog.invalidate()
    ])
  const test = trpc.definitionAssistants.testAgentOne.useMutation({
    retry: false,
    onSuccess: refresh
  })
  const save = trpc.definitionAssistants.updateSettings.useMutation({
    onSuccess: async (updated) => {
      utils.definitionAssistants.settings.setData(undefined, updated)
      setDraft(null)
      await refresh()
    }
  })
  const current = draft ?? {
    agentOneEnabled: settings.agentOne.enabled,
    defaultProfile: settings.defaultProfile
  }
  const ready = settings.agentOne.configured && settings.agentOne.validated
  const busy = test.isPending || save.isPending
  const changed =
    current.agentOneEnabled !== settings.agentOne.enabled ||
    current.defaultProfile !== settings.defaultProfile
  const available = (profile: AssistantProfile) =>
    profile === "agent-one"
      ? ready && current.agentOneEnabled
      : !!settings.profiles.find((entry) => entry.id === profile)?.available
  const canSave =
    changed &&
    (!current.agentOneEnabled || ready) &&
    available(current.defaultProfile)
  const status = !settings.agentOne.configured
    ? "Not configured"
    : !settings.agentOne.validated
      ? "Needs validation"
      : settings.agentOne.enabled
        ? "Available"
        : "Validated · disabled"
  const StatusIcon = ready
    ? settings.agentOne.enabled
      ? CheckCircle2Icon
      : CircleOffIcon
    : TriangleAlertIcon
  const result = test.data

  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <SunIcon aria-hidden />
          Definition assistants
        </h2>
      </div>
      <div className="flex min-w-0 flex-col gap-5 px-5 py-4 text-sm">
        <p className="text-muted-foreground">
          Enable assistants for definition requests and choose the default.
          Contributors can choose another available assistant. Study requests
          follow the assistant policy of the study.
        </p>
        <section
          aria-labelledby={`${id}-agent-one`}
          className="min-w-0 space-y-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${id}-agent-one`} className="font-medium">
              Wolfram Agent One
            </h3>
            <span
              className={cn(
                styles.statusLabel,
                ready
                  ? settings.agentOne.enabled
                    ? styles.statusReady
                    : styles.statusMuted
                  : styles.statusWarning
              )}
            >
              <StatusIcon aria-hidden className="mr-1 inline size-4" />
              {status}
            </span>
          </div>
          <p className="text-muted-foreground">
            Configure a key with Agent One permission in the protected server
            setting <code className="break-all">WOLFRAM_AGENT_ONE_API_KEY</code>
            , then restart the application. Wolfram reference lookup uses its
            own configuration.
          </p>
          <p className="text-muted-foreground">
            Test a sample materials-science definition before enabling Agent
            One. The test checks the response format and saves its validation
            status.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!settings.agentOne.configured || busy}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing Agent One…" : "Test Agent One"}
          </Button>
          {settings.agentOne.validatedAt ? (
            <p className="text-xs text-muted-foreground">
              Validated{" "}
              <time dateTime={settings.agentOne.validatedAt}>
                {settings.agentOne.validatedAt.slice(0, 19).replace("T", " ")}{" "}
                UTC
              </time>
            </p>
          ) : null}
          <div aria-live="polite">
            {test.isPending ? <p>Checking a definition response…</p> : null}
            {result && !test.isPending && !test.isError ? (
              <div className="space-y-1">
                <p
                  className={cn(
                    "font-medium",
                    result.status === "failed" && "text-destructive"
                  )}
                >
                  {result.status === "passed" ? "Test passed" : "Test failed"}
                  {" · "}
                  {(result.elapsedMs / 1000).toFixed(2)} s
                </p>
                <p className="text-muted-foreground">{result.message}</p>
                {result.inference ? (
                  <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    Service: Wolfram Agent One · Requested model:{" "}
                    {result.inference.model}
                    {result.inference.responseModel
                      ? ` · Returned model: ${result.inference.responseModel}`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          {test.isError ? (
            <p role="alert" className="text-destructive">
              {test.error.message}
            </p>
          ) : null}
        </section>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (busy || !canSave) return
            save.mutate(current)
          }}
        >
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${id}-enabled`}>
                Enable Wolfram Agent One
              </FieldLabel>
              <FieldDescription id={`${id}-enabled-help`}>
                {ready
                  ? "Offer Agent One as a definition assistant."
                  : "Requires a configured key and a successful definition test."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${id}-enabled`}
              aria-describedby={`${id}-enabled-help`}
              checked={current.agentOneEnabled}
              disabled={busy || (!ready && !current.agentOneEnabled)}
              onCheckedChange={(enabled) => {
                if (busy || (enabled && !ready)) return
                save.reset()
                setDraft({
                  agentOneEnabled: enabled,
                  defaultProfile:
                    !enabled && current.defaultProfile === "agent-one"
                      ? "default"
                      : current.defaultProfile
                })
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-default`}>
              Default definition assistant
            </FieldLabel>
            <select
              id={`${id}-default`}
              value={current.defaultProfile}
              disabled={busy}
              aria-describedby={`${id}-default-help`}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              onChange={(event) => {
                const profile = event.target.value as AssistantProfile
                if (busy || !available(profile)) return
                save.reset()
                setDraft({ ...current, defaultProfile: profile })
              }}
            >
              {settings.profiles.map((profile) => (
                <option
                  key={profile.id}
                  value={profile.id}
                  disabled={!available(profile.id)}
                >
                  {profile.label}
                  {!available(profile.id) ? " (unavailable)" : ""}
                </option>
              ))}
            </select>
            <FieldDescription id={`${id}-default-help`}>
              Applies to future requests without a contributor preference.
              Existing requests and saved attribution keep their assistant.
            </FieldDescription>
            {!available(current.defaultProfile) ? (
              <p role="status" className="text-sm text-destructive">
                The selected default is unavailable. Enable and validate it, or
                choose an available assistant before saving.
              </p>
            ) : null}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={busy || !canSave}>
              {save.isPending ? "Saving…" : "Save assistant settings"}
            </Button>
            {changed ? (
              <p className="text-xs text-muted-foreground">Unsaved changes</p>
            ) : save.isSuccess ? (
              <p role="status" className="text-sm text-muted-foreground">
                Assistant settings saved.
              </p>
            ) : null}
          </div>
          {save.isError ? (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          ) : null}
        </form>
      </div>
    </article>
  )
}
