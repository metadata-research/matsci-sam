"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function WorkspaceSettings({
  workspace
}: {
  workspace: RouterOutput["matcoreWorkflow"]["workspace"]
}) {
  const router = useRouter()
  const configure = trpc.matcoreWorkflow.configureWorkspace.useMutation()
  const [error, setError] = useState("")
  if (!workspace.canManage) return null
  async function change(metadataEnabled: boolean, matcoreEnabled: boolean) {
    setError("")
    try {
      await configure.mutateAsync({
        vocabularySlug: workspace.vocabularySlug,
        metadataEnabled,
        matcoreEnabled
      })
      router.refresh()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Workspace settings could not be saved."
      )
    }
  }
  return (
    <details
      className="rounded-lg border p-4"
      aria-labelledby="workspace-tools"
    >
      <summary
        id="workspace-tools"
        data-section-target
        className="cursor-pointer font-medium"
      >
        Workspace tools
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Enable metadata development to define fields and value rules alongside
          ordinary vocabulary terms. MatCore is an optional standard; enabling
          it does not import anything.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={configure.isPending}
            onClick={() =>
              void change(
                !workspace.metadataEnabled,
                workspace.metadataEnabled ? false : workspace.matcoreEnabled
              )
            }
          >
            {workspace.metadataEnabled
              ? "Disable new metadata fields"
              : "Enable metadata development"}
          </Button>
          {workspace.metadataEnabled ? (
            <Button
              variant="outline"
              disabled={configure.isPending}
              onClick={() => void change(true, !workspace.matcoreEnabled)}
            >
              {workspace.matcoreEnabled
                ? "Disable MatCore imports"
                : "Enable MatCore"}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Disabling a tool stops new work with it. Existing drafts, proposals
          and history remain available.
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Settings could not be saved</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </details>
  )
}
