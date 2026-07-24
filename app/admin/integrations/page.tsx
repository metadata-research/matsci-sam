import { HydrateClient, trpc } from "@/trpc/server"
import { Suspense } from "react"
import { TestOllama } from "./ollama"
import { WolframCard } from "./wolfram"
import { AdminPageHeader } from "../page-header"
import { AiSubnav } from "../ai-subnav"
import styles from "../admin.module.css"
import {
  CheckCircle2Icon,
  CircleOffIcon,
  KeyRoundIcon,
  TriangleAlertIcon
} from "lucide-react"
import { cn } from "@/lib/utils"

export default async function AdminIntegrationsPage() {
  void trpc.admin.ollama.prefetch()
  const integrationsPromise = trpc.admin.integrations()
  const integrations = await integrationsPromise

  return (
    <HydrateClient>
      <AdminPageHeader
        title="AI & services"
        description="Review inference, identity, and external service readiness without exposing protected configuration."
      />
      <div className={styles.sectionStack}>
        <AiSubnav />

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <KeyRoundIcon aria-hidden />
              Authentication and access
            </h2>
          </div>
          <ul className={styles.statusList}>
            <ConfigurationRow
              label="Google sign-in"
              status={integrations.services.google.status}
            />
            <ConfigurationRow
              label="Email sign-in"
              status={integrations.services.email.status}
            />
            <ConfigurationRow
              label="ORCID"
              status={integrations.services.orcid.status}
            />
            <ConfigurationRow
              label="Development sign-in"
              status={integrations.services.development.status}
            />
          </ul>
        </section>

        <Suspense fallback={<IntegrationLoading label="Ollama" />}>
          <TestOllama />
        </Suspense>
        <WolframCard configured={integrations.wolfram.configured} />
      </div>
    </HydrateClient>
  )
}

function ConfigurationRow({
  label,
  status
}: {
  label: string
  status:
    | "ready"
    | "configured"
    | "disabled"
    | "not_configured"
    | "misconfigured"
    | "unreachable"
}) {
  const ready = status === "ready" || status === "configured"
  const warning = status === "misconfigured" || status === "unreachable"
  const text =
    status === "configured"
      ? "Settings present"
      : status === "misconfigured"
        ? "Needs attention"
        : status === "not_configured"
          ? "Not configured"
          : status === "ready"
            ? "Ready"
            : status === "unreachable"
              ? "Unreachable"
              : "Disabled"

  return (
    <li className={styles.statusRow}>
      {ready ? (
        <CheckCircle2Icon
          aria-hidden
          className={cn(styles.statusIcon, styles.statusIconReady)}
        />
      ) : warning ? (
        <TriangleAlertIcon
          aria-hidden
          className={cn(styles.statusIcon, styles.statusIconWarning)}
        />
      ) : (
        <CircleOffIcon aria-hidden className={styles.statusIcon} />
      )}
      <span>{label}</span>
      <span
        className={cn(
          styles.statusLabel,
          ready
            ? styles.statusReady
            : warning
              ? styles.statusWarning
              : styles.statusMuted
        )}
      >
        {text}
      </span>
      <span aria-hidden />
    </li>
  )
}

function IntegrationLoading({ label }: { label: string }) {
  return (
    <div className={`${styles.panel} p-5 text-sm text-muted-foreground`}>
      Checking {label}…
    </div>
  )
}
