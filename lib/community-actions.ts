import { communitySectionHref } from "./community-navigation"

export type CommunityActionContext = {
  communityId?: number
  communitySlug?: string
  vocabularySlug?: string
  metadataEnabled?: boolean
  profile?: string
  release?: string
}

export function setupHref(
  context: CommunityActionContext = {},
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

export function communityContributionActions(
  context: CommunityActionContext = {}
) {
  const addParams = new URLSearchParams()
  if (context.vocabularySlug)
    addParams.set("vocabularySlug", context.vocabularySlug)
  const href = (view: string) =>
    context.communitySlug
      ? communitySectionHref(context.communitySlug, view, undefined, {
          profile: context.profile,
          release: context.release
        })
      : null
  return {
    term: {
      id: "term" as const,
      label: "Add term",
      description: "Define one term in a vocabulary.",
      helpHref: "/docs#add-term",
      helpLabel: "Help with adding a term",
      href: addParams.size ? `/add?${addParams}` : "/add"
    },
    field:
      context.metadataEnabled && context.communitySlug
        ? {
            id: "field" as const,
            label: "Propose field",
            description: "Define a metadata field and its value rules.",
            helpHref: "/docs/matcore-workflow#start-a-metadata-field",
            helpLabel: "Help with proposing a metadata field",
            href: `${href("contributions")}&action=new`
          }
        : null,
    change: {
      id: "change" as const,
      label: "Suggest a change",
      href: href("vocabulary") ?? "/terms"
    },
    feedback: {
      id: "feedback" as const,
      label: "Give feedback",
      href: href("review") ?? "/communities"
    },
    draft: {
      id: "draft" as const,
      label: "Continue a draft",
      href: href("work") ?? "/profile/drafts"
    }
  }
}

export function communityCreationActions(context: CommunityActionContext = {}) {
  const contribution = communityContributionActions(context)
  return [
    contribution.term,
    ...(contribution.field ? [contribution.field] : []),
    {
      id: "import" as const,
      label: "Import terms",
      description: "Add a batch of terms and definitions.",
      helpHref: "/docs#import-terms",
      helpLabel: "Help with importing terms",
      href: setupHref(context, "import")
    },
    {
      id: "collection" as const,
      label: "Create collection",
      description: "Select terms from any vocabulary.",
      helpHref: "/docs#create-collection",
      helpLabel: "Help with creating a collection",
      href: setupHref(context, "collection")
    },
    {
      id: "vocabulary" as const,
      label: "Create vocabulary",
      description: "Name a body of terms and definitions.",
      helpHref: "/docs#create-vocabulary",
      helpLabel: "Help with creating a vocabulary",
      href: setupHref(context, "vocabulary")
    },
    {
      id: "community" as const,
      label: "Create community",
      description: "Bring people together to contribute.",
      helpHref: "/docs#create-community",
      helpLabel: "Help with creating a community",
      href: setupHref(context, "community")
    }
  ]
}
