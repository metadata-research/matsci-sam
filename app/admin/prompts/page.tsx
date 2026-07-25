import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import prompts from "@/lib/prompts.json"
import { AdminPageHeader } from "../page-header"
import { AiSubnav } from "../ai-subnav"
import styles from "../admin.module.css"
import { FileCode2Icon } from "lucide-react"

export default function AdminPromptsPage() {
  const rawOverride = Boolean(process.env.SYSTEM_PROMPT)
  const activeKey = process.env.SYSTEM_PROMPT_KEY

  return (
    <div className={styles.sectionStack}>
      <AdminPageHeader
        title="Prompt registry"
        description="Inspect the versioned instructions available to the AI definition and refinement pipelines."
      />
      <AiSubnav />
      {rawOverride && (
        <Card className="border-ai">
          <CardHeader>
            <CardTitle>Raw override active</CardTitle>
            <CardDescription>
              The <code>SYSTEM_PROMPT</code> environment variable is set and
              takes precedence over the named registry.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>
            <FileCode2Icon aria-hidden />
            Available prompts
          </h2>
          <span className={styles.panelMeta}>
            {Object.keys(prompts).length} registered
          </span>
        </div>
        <div className="divide-y">
          {Object.entries(prompts).map(([key, { description, prompt }]) => (
            <article key={key} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={styles.codeText}>{key}</h3>
                {!rawOverride && key === activeKey && (
                  <Badge className="bg-ai text-white">Active</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{description}</p>
              <details className="text-sm">
                <summary className="cursor-pointer text-primary">
                  View prompt text
                </summary>
                <p className="mt-3 whitespace-pre-wrap border-l-2 pl-4 text-muted-foreground">
                  {prompt}
                </p>
              </details>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
