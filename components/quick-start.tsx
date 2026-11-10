import Link from "next/link"
import {
  ArrowRightIcon,
  BookOpenIcon,
  FolderPlusIcon,
  InfoIcon,
  ListPlusIcon,
  ListTreeIcon,
  PlusIcon,
  UsersIcon
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

import {
  communityCreationActions,
  setupHref,
  type CommunityActionContext
} from "@/lib/community-actions"

export { setupHref } from "@/lib/community-actions"

const actionIcons = {
  term: PlusIcon,
  field: ListTreeIcon,
  import: ListPlusIcon,
  collection: FolderPlusIcon,
  vocabulary: BookOpenIcon,
  community: UsersIcon
}

export function quickStartActions(context: CommunityActionContext = {}) {
  return communityCreationActions(context).map((action) => ({
    ...action,
    icon: actionIcons[action.id]
  }))
}

export function QuickStartBar({
  communityId,
  vocabularySlug,
  communitySlug,
  metadataEnabled,
  profile,
  className
}: CommunityActionContext & { className?: string }) {
  const context = {
    communityId,
    vocabularySlug,
    communitySlug,
    metadataEnabled,
    profile
  }

  return (
    <section aria-label="Quick start" className={cn(className)}>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Quick start</CardTitle>
            <CardDescription>
              Choose a task, or work through the steps together.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={setupHref(context)}>
              Guide me through setup
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
            {quickStartActions(context).map((action) => (
              <li key={action.id} className="flex min-w-0 flex-col gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={action.href}>
                    <action.icon data-icon="inline-start" aria-hidden />
                    {action.label}
                  </Link>
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {action.description}{" "}
                  <Link
                    href={action.helpHref}
                    aria-label={action.helpLabel}
                    title={action.helpLabel}
                    className="inline-flex size-6 items-center justify-center rounded-full align-middle transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <InfoIcon className="size-3.5" aria-hidden />
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
