"use client"

import { trpc } from "@/trpc/client"
import {
  ActivityIcon,
  BellIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleOffIcon,
  Clock3Icon,
  Code2Icon,
  MailIcon,
  RefreshCwIcon,
  SunIcon,
  TriangleAlertIcon
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import styles from "./admin.module.css"

type GenerationAttention = {
  waiting: number
  failedRefinements: number
}

type Status =
  | "ready"
  | "configured"
  | "disabled"
  | "not_configured"
  | "misconfigured"
  | "unreachable"

const statusText: Record<Status, string> = {
  ready: "Ready",
  configured: "Settings present",
  disabled: "Disabled",
  not_configured: "Not configured",
  misconfigured: "Needs attention",
  unreachable: "Unreachable"
}

const statusClass = (status: Status) => {
  if (status === "ready" || status === "configured") return styles.statusReady
  if (status === "unreachable" || status === "misconfigured")
    return styles.statusWarning
  return styles.statusMuted
}

const StatusSymbol = ({ status }: { status: Status }) => {
  if (status === "ready" || status === "configured")
    return (
      <CheckCircle2Icon
        aria-hidden
        className={cn(styles.statusIcon, styles.statusIconReady)}
      />
    )
  if (status === "unreachable" || status === "misconfigured")
    return (
      <TriangleAlertIcon
        aria-hidden
        className={cn(styles.statusIcon, styles.statusIconWarning)}
      />
    )
  return (
    <CircleOffIcon
      aria-hidden
      className={cn(styles.statusIcon, styles.statusIconMuted)}
    />
  )
}

export function DashboardSummary({
  generationAttention
}: {
  generationAttention: GenerationAttention
}) {
  const [health, { isFetching, refetch }] =
    trpc.admin.serviceHealth.useSuspenseQuery()

  return (
    <section
      className={styles.overviewSummary}
      aria-label="Administrative status"
    >
      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <BellIcon aria-hidden />
            Needs attention
          </h2>
        </div>
        <ul className={styles.statusList}>
          <li className={cn(styles.statusRow, styles.statusRowCompact)}>
            <CircleOffIcon aria-hidden className={styles.statusIcon} />
            <span>Moderation queue not yet enabled</span>
          </li>
          <li className={cn(styles.statusRow, styles.statusRowCompact)}>
            <Clock3Icon aria-hidden className={styles.statusIcon} />
            <span>
              {generationAttention.waiting} generation{" "}
              {generationAttention.waiting === 1 ? "job" : "jobs"} waiting
            </span>
          </li>
          {generationAttention.failedRefinements > 0 ? (
            <li className={cn(styles.statusRow, styles.statusRowCompact)}>
              <TriangleAlertIcon
                aria-hidden
                className={cn(styles.statusIcon, styles.statusIconWarning)}
              />
              <span>
                {generationAttention.failedRefinements} failed{" "}
                {generationAttention.failedRefinements === 1
                  ? "refinement"
                  : "refinements"}{" "}
                need review
              </span>
            </li>
          ) : (
            <li className={cn(styles.statusRow, styles.statusRowCompact)}>
              {health.ollama.status === "ready" ? (
                <CheckCircle2Icon
                  aria-hidden
                  className={cn(styles.statusIcon, styles.statusIconReady)}
                />
              ) : (
                <TriangleAlertIcon
                  aria-hidden
                  className={cn(styles.statusIcon, styles.statusIconWarning)}
                />
              )}
              <span>
                {health.ollama.status === "ready"
                  ? "Ollama is ready for AI assistance"
                  : "Ollama is unavailable in this environment"}
              </span>
            </li>
          )}
          <li className={cn(styles.statusRow, styles.statusRowCompact)}>
            {health.wolfram.status === "configured" ? (
              <CheckCircle2Icon
                aria-hidden
                className={cn(styles.statusIcon, styles.statusIconReady)}
              />
            ) : (
              <TriangleAlertIcon
                aria-hidden
                className={cn(styles.statusIcon, styles.statusIconWarning)}
              />
            )}
            <span>
              {health.wolfram.status === "configured"
                ? "Wolfram settings are present"
                : "Wolfram is not configured"}
            </span>
          </li>
        </ul>
        <div className={styles.panelFooter}>
          <Link href="/admin/integrations" className={styles.textLink}>
            Review services
            <ChevronRightIcon aria-hidden />
          </Link>
        </div>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <ActivityIcon aria-hidden />
            Service health
          </h2>
          <div className={styles.panelHeaderActions}>
            <span className={styles.panelMeta}>Checked just now</span>
            <button
              type="button"
              className={cn(
                styles.refreshButton,
                isFetching && styles.refreshing
              )}
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Refresh service health"
            >
              <RefreshCwIcon aria-hidden />
            </button>
          </div>
        </div>
        <ul className={styles.statusList}>
          <ServiceRow
            name="Ollama"
            status={health.ollama.status}
            mark={<BotIcon aria-hidden />}
          />
          <ServiceRow
            name="Google sign-in"
            status={health.google.status}
            mark={<span className={styles.googleMark}>G</span>}
          />
          <ServiceRow
            name="Email sign-in"
            status={health.email.status}
            mark={<MailIcon aria-hidden />}
          />
          <ServiceRow
            name="ORCID"
            status={health.orcid.status}
            mark={<span className={styles.orcidMark}>iD</span>}
          />
          <ServiceRow
            name="Wolfram"
            status={health.wolfram.status}
            warningWhenNotConfigured
            mark={<SunIcon aria-hidden className={styles.wolframMark} />}
          />
          <ServiceRow
            name="Development sign-in"
            status={health.development.status}
            configuredLabel="Active"
            mark={<Code2Icon aria-hidden />}
          />
        </ul>
        <div className={styles.panelFooter}>
          <Link href="/admin/integrations" className={styles.textLink}>
            Review services
            <ChevronRightIcon aria-hidden />
          </Link>
        </div>
      </article>
    </section>
  )
}

function ServiceRow({
  name,
  status,
  configuredLabel,
  warningWhenNotConfigured = false,
  mark
}: {
  name: string
  status?: Status
  configuredLabel?: string
  warningWhenNotConfigured?: boolean
  mark: React.ReactNode
}) {
  const visualStatus =
    warningWhenNotConfigured && status === "not_configured"
      ? "misconfigured"
      : status

  return (
    <li className={styles.statusRow}>
      <span className={styles.serviceMark}>{mark}</span>
      <span>{name}</span>
      {status ? (
        <span className={cn(styles.statusLabel, statusClass(visualStatus!))}>
          {status === "configured" && configuredLabel
            ? configuredLabel
            : statusText[status]}
        </span>
      ) : (
        <span className={cn(styles.statusLabel, styles.statusMuted)}>
          Checking
        </span>
      )}
      {visualStatus ? (
        <StatusSymbol status={visualStatus} />
      ) : (
        <Clock3Icon aria-hidden />
      )}
    </li>
  )
}
