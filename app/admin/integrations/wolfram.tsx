"use client"

import { Button } from "@/components/ui/button"
import { trpc } from "@/trpc/client"
import { toast } from "sonner"
import { CheckCircle2Icon, SunIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import styles from "../admin.module.css"

export const WolframCard = ({ configured }: { configured: boolean }) => {
  const test = trpc.admin.wolframTest.useMutation({
    onError: (err) => toast.error(err.message)
  })

  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <SunIcon aria-hidden />
          Wolfram AgentOne
        </h2>
        <span
          className={cn(
            styles.statusLabel,
            configured ? styles.statusReady : styles.statusWarning
          )}
        >
          {configured ? (
            <CheckCircle2Icon aria-hidden className="mr-1 inline size-4" />
          ) : (
            <TriangleAlertIcon aria-hidden className="mr-1 inline size-4" />
          )}
          {configured ? "Settings present" : "Not configured"}
        </span>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-muted-foreground">
          LLM responses combined with Wolfram Language computation and curated
          knowledge. Configure with the <code>WOLFRAM_API_KEY</code> environment
          variable.
        </p>
        {configured ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
            {test.data && (
              <p className="text-sm text-muted-foreground italic">
                {test.data.content}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Wolfram-backed features remain disabled until the protected server
            environment includes an API key.
          </p>
        )}
      </div>
    </article>
  )
}
