"use client"

import { trpc } from "@/trpc/client"
import {
  BotIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
  TriangleAlertIcon
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import styles from "../admin.module.css"

export const InferenceHealthCard = () => {
  const [data, { isFetching, refetch }] =
    trpc.admin.inference.useSuspenseQuery()
  const ready = data.status === "ready"

  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <BotIcon aria-hidden />
          Inference
        </h2>
        <div
          className={cn(
            styles.statusLabel,
            ready ? styles.statusReady : styles.statusWarning
          )}
        >
          {ready ? (
            <CheckCircle2Icon aria-hidden className="mr-1 inline size-4" />
          ) : (
            <TriangleAlertIcon aria-hidden className="mr-1 inline size-4" />
          )}
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
        </div>
      </div>
      <div className="space-y-2 px-5 py-4 text-sm">
        <p className="text-muted-foreground">
          The active provider is selected in server configuration. Readiness
          checks model availability; it does not generate a definition.
        </p>
        {ready && data.model ? (
          <dl className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Model</dt>
              <dd className={`${styles.codeText} break-all`}>
                {data.model.name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Profile</dt>
              <dd>{data.profile}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Provider</dt>
              <dd>{data.provider}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground">
            The application could not confirm the selected inference service.
            Check its server configuration and connectivity.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCwIcon aria-hidden />
            {isFetching ? "Checking…" : "Refresh inference health"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/inference">Test a prompt</Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            Checked {data.checkedAt.slice(11, 19)} UTC
          </span>
        </div>
      </div>
    </article>
  )
}
