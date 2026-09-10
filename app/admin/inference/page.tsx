import { Suspense } from "react"
import { HydrateClient, trpc } from "@/trpc/server"
import { AiSubnav } from "../ai-subnav"
import { AdminPageHeader } from "../page-header"
import styles from "../admin.module.css"
import { InferenceTester } from "./tester"

export default function AdminInferencePage() {
  void trpc.admin.inferenceTestConfiguration.prefetch()

  return (
    <HydrateClient>
      <AdminPageHeader
        title="Inference testing"
        description="Try a prompt with the active inference provider and inspect its response."
      />
      <div className={styles.sectionStack}>
        <AiSubnav />
        <Suspense
          fallback={
            <div
              className={`${styles.panel} p-5 text-sm text-muted-foreground`}
            >
              Loading inference configuration…
            </div>
          }
        >
          <InferenceTester />
        </Suspense>
      </div>
    </HydrateClient>
  )
}
