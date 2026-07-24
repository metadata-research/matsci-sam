"use client"

import { trpc } from "@/trpc/client"
import { BotIcon, CheckCircle2Icon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import styles from "../admin.module.css"

export const TestOllama = () => {
  const [data] = trpc.admin.ollama.useSuspenseQuery()
  const ready = data.status === "ready"

  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <BotIcon aria-hidden />
          Ollama
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
          {ready
            ? "Ready"
            : data.status === "not_configured"
              ? "Not configured"
              : "Unreachable"}
        </div>
      </div>
      <div className="space-y-2 px-5 py-4 text-sm">
        {ready ? (
          <dl className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Model</dt>
              <dd className={styles.codeText}>{data.model.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Family</dt>
              <dd>{data.model.family}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Parameters</dt>
              <dd>{data.model.parameterSize}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground">
            The application could not confirm the configured model. Internal
            host and error details are withheld from the web interface.
          </p>
        )}
      </div>
    </article>
  )
}
