import Link from "next/link"
import {
  ArrowRightIcon,
  BookOpenIcon,
  FolderPlusIcon,
  InfoIcon,
  ListPlusIcon,
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

type QuickStartContext = {
  communityId?: number
  vocabularySlug?: string
}

export function setupHref(
  context: QuickStartContext = {},
  task?: "community" | "vocabulary" | "collection" | "import"
) {
  const params = new URLSearchParams()
  if (task) params.set("task", task)
  if (context.communityId)
    params.set("communityId", String(context.communityId))
  if (context.vocabularySlug)
    params.set("vocabularySlug", context.vocabularySlug)
  return params.size ? `/setup?${params}` : "/setup"
}

export function quickStartActions(context: QuickStartContext = {}) {
  const addParams = new URLSearchParams()
  if (context.vocabularySlug)
    addParams.set("vocabularySlug", context.vocabularySlug)

  return [
    {
      id: "term",
      label: "Add term",
      description: "Define one term in a vocabulary.",
      helpHref: "/docs#add-term",
      helpLabel: "Help with adding a term",
      href: addParams.size ? `/add?${addParams}` : "/add",
      icon: PlusIcon
    },
    {
      id: "import",
      label: "Import terms",
      description: "Add a batch of terms and definitions.",
      helpHref: "/docs#import-terms",
      helpLabel: "Help with importing terms",
      href: setupHref(context, "import"),
      icon: ListPlusIcon
    },
    {
      id: "collection",
      label: "Create collection",
      description: "Select terms from any vocabulary.",
      helpHref: "/docs#create-collection",
      helpLabel: "Help with creating a collection",
      href: setupHref(context, "collection"),
      icon: FolderPlusIcon
    },
    {
      id: "vocabulary",
      label: "Create vocabulary",
      description: "Name a body of terms and definitions.",
      helpHref: "/docs#create-vocabulary",
      helpLabel: "Help with creating a vocabulary",
      href: setupHref(context, "vocabulary"),
      icon: BookOpenIcon
    },
    {
      id: "community",
      label: "Create community",
      description: "Bring people together to contribute.",
      helpHref: "/docs#create-community",
      helpLabel: "Help with creating a community",
      href: setupHref(context, "community"),
      icon: UsersIcon
    }
  ]
}

export function QuickStartBar({
  communityId,
  vocabularySlug,
  className
}: QuickStartContext & { className?: string }) {
  const context = { communityId, vocabularySlug }

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
