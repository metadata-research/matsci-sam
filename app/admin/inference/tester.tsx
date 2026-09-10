"use client"

import { useState } from "react"
import Link from "next/link"
import { PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  inferenceTestModes,
  type InferenceTestInput
} from "@/lib/llm/test-options"
import type { InferenceMetadata } from "@/lib/llm/types"
import { trpc } from "@/trpc/client"
import styles from "../admin.module.css"

export function InferenceTester() {
  const [config] = trpc.admin.inferenceTestConfiguration.useSuspenseQuery()
  const test = trpc.admin.inferenceTest.useMutation({ retry: false })
  const [mode, setMode] = useState<InferenceTestInput["mode"]>("answer")
  const [prompt, setPrompt] = useState(
    "Explain transfer learning in two sentences, with a materials-science use case."
  )
  const configured = config.status === "configured"
  const result = test.data

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Test a prompt</h2>
          <Link href="/admin/integrations" className="text-sm underline">
            Service health
          </Link>
        </div>
        <form
          className="space-y-5 p-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!configured || test.isPending || !prompt.trim()) return
            test.mutate({ mode, prompt })
          }}
        >
          {configured ? (
            <InferenceIdentity inference={config.inference} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              Inference configuration is incomplete or invalid. Review the
              server configuration before running a test.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Tests use the provider selected in server configuration. Your prompt
            is sent to that provider; no terms, definitions, or study responses
            are saved in MatSci-SAM.
          </p>
          <div className="space-y-2">
            <label
              htmlFor="inference-test-mode"
              className="block text-sm font-medium"
            >
              Response format
            </label>
            <select
              id="inference-test-mode"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-auto"
              value={mode}
              disabled={test.isPending}
              onChange={(event) =>
                setMode(event.target.value as InferenceTestInput["mode"])
              }
              aria-describedby="inference-test-format-help"
            >
              {Object.entries(inferenceTestModes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p
              id="inference-test-format-help"
              className="text-sm text-muted-foreground"
            >
              {mode === "definition"
                ? "Uses the app's definition system prompt and requires definition and example fields. Include the term you want defined."
                : "Requires an answer field. Both formats test the structured JSON output used by the app."}
            </p>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="inference-test-prompt"
              className="block text-sm font-medium"
            >
              Prompt
            </label>
            <Textarea
              id="inference-test-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              maxLength={4000}
              disabled={test.isPending}
              rows={5}
              className="min-h-36"
              aria-describedby="inference-test-length"
            />
            <p
              id="inference-test-length"
              className="text-xs text-muted-foreground"
            >
              {prompt.length.toLocaleString()} / 4,000 characters
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!configured || test.isPending || !prompt.trim()}
            >
              <PlayIcon aria-hidden />
              {test.isPending ? "Running test…" : "Run test"}
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {test.isPending && configured
                ? `Waiting for a response. The request timeout is ${config.timeoutMs / 1000} seconds.`
                : ""}
            </p>
          </div>
          {test.isError && (
            <p role="alert" className="text-sm text-destructive">
              The test request failed. Check your connection and administrator
              session, then try again.
            </p>
          )}
        </form>
      </section>

      {result && !test.isPending && !test.isError && (
        <section
          className={styles.panel}
          aria-label="Last test result"
          aria-live="polite"
        >
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {result.status === "passed" ? "Test passed" : "Test failed"}
            </h2>
            <span className="text-sm tabular-nums">
              {(result.elapsedMs / 1000).toFixed(2)} s
            </span>
          </div>
          <div className="space-y-5 p-5">
            <p className="text-sm text-muted-foreground">
              {inferenceTestModes[result.mode]} ·{" "}
              {new Date(result.testedAt).toLocaleString()}
              {result.status === "passed" && " · JSON schema validated"}
            </p>
            {result.inference && (
              <InferenceIdentity inference={result.inference} />
            )}
            <div>
              <h3 className="mb-1 text-sm font-medium">Submitted prompt</h3>
              <p className="whitespace-pre-wrap break-words text-sm">
                {result.prompt}
              </p>
            </div>
            {result.status === "passed" ? (
              <>
                {Object.entries(result.output).map(([key, value]) => (
                  <div key={key}>
                    <h3 className="mb-1 text-sm font-medium capitalize">
                      {key}
                    </h3>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {value}
                    </p>
                  </div>
                ))}
                <details className="text-sm">
                  <summary className="cursor-pointer">Response JSON</summary>
                  <pre className="mt-3 whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(result.output, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                {result.message}
              </p>
            )}
          </div>
        </section>
      )}
    </>
  )
}

function InferenceIdentity({ inference }: { inference: InferenceMetadata }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {[
        ["Profile", inference.profile],
        ["Provider", inference.provider],
        ["Requested model", inference.model],
        ...(inference.responseModel
          ? [["Returned model", inference.responseModel]]
          : [])
      ].map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
