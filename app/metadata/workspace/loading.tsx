import { Skeleton } from "@/components/ui/skeleton"

export default function WorkspaceLoading() {
  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8"
      aria-label="Loading metadata workspace"
    >
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </main>
  )
}
