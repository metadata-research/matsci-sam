"use client"

import { trpc } from "@/trpc/client"
import {
  BotIcon,
  CheckCircle2Icon,
  CircleOffIcon,
  RefreshCwIcon,
  TriangleAlertIcon
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { InferenceHealth } from "@/lib/llm/health"
import { cn } from "@/lib/utils"
import styles from "../admin.module.css"

export const InferenceHealthCard = () => {
  const [data, { isFetching, isRefetchError, refetch }] =
    trpc.admin.inferenceEndpoints.useSuspenseQuery()

  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <BotIcon aria-hidden />
          Inference
        </h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4 text-sm">
        <p className="text-muted-foreground">
          Readiness checks model availability for each endpoint. It does not
          generate a response or switch the endpoint in use.
        </p>
        <div className="grid gap-4 lg:grid-cols-2" aria-busy={isFetching}>
          <EndpointHealth title="In use" data={data.active} />
          <EndpointHealth title="Alternate" data={data.alternate} />
        </div>
        <p className="text-muted-foreground">
          Change the inference endpoint in the server environment file, then
          restart the application. Update the provider, profile, and model
          together. The alternate is configured separately for health checks.{" "}
          <Link
            href="/docs/administration#inference-services"
            className="underline"
          >
            Configuration instructions
          </Link>
        </p>
        {isRefetchError ? (
          <p role="alert">
            Health could not be refreshed. The last check is still shown.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCwIcon aria-hidden data-icon="inline-start" />
            {isFetching ? "Checking…" : "Refresh inference health"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/inference">Test the endpoint in use</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

function EndpointHealth({
  title,
  data
}: {
  title: string
  data: InferenceHealth
}) {
  const ready = data.status === "ready"
  const missing = data.status === "not_configured"
  const StatusIcon = ready
    ? CheckCircle2Icon
    : missing
      ? CircleOffIcon
      : TriangleAlertIcon

  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <span
          className={cn(
            styles.statusLabel,
            ready
              ? styles.statusReady
              : missing
                ? styles.statusMuted
                : styles.statusWarning
          )}
        >
          <StatusIcon aria-hidden className="mr-1 inline size-4" />
          {
            {
              ready: "Ready",
              not_configured: "Not configured",
              misconfigured: "Needs configuration",
              authentication_failed: "Authentication failed",
              model_missing: "Model unavailable",
              unreachable: "Unreachable"
            }[data.status]
          }
        </span>
      </div>
      {data.provider ? (
        <dl className="grid gap-2">
          <div>
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd>
              {data.provider === "ollama" ? "Ollama" : "OpenAI-compatible"}
            </dd>
          </div>
          {data.profile ? (
            <div>
              <dt className="text-xs text-muted-foreground">Profile</dt>
              <dd className="break-all">{data.profile}</dd>
            </div>
          ) : null}
          {data.model ? (
            <div>
              <dt className="text-xs text-muted-foreground">Model</dt>
              <dd className={cn(styles.codeText, "break-all")}>
                {data.model.name}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {!ready ? (
        <p className="text-muted-foreground">
          {missing
            ? "Add this endpoint’s settings to the server environment file to check its health."
            : "Check this endpoint’s server configuration and connectivity."}
        </p>
      ) : null}
      <p className="mt-auto text-xs text-muted-foreground">
        Checked{" "}
        <time dateTime={data.checkedAt}>
          {data.checkedAt.slice(11, 19)} UTC
        </time>
      </p>
    </section>
  )
}
