import { Badge } from "@/components/ui/badge"
import { PublicProfileName } from "@/components/public-profile-name"
import { ProvDetail } from "./detail"
import type { ProvEvent } from "@/lib/provenance"
import { formatDateTime } from "@/lib/date"
import {
  BotIcon,
  CheckIcon,
  FilePlusIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PencilIcon,
  SparklesIcon,
  TagIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  UndoIcon,
  UserIcon,
  WandSparklesIcon
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const KIND: Record<ProvEvent["kind"], { icon: LucideIcon; color: string }> = {
  "term-created": { icon: TagIcon, color: "text-green-600" },
  "initial-message": {
    icon: MessageCircleIcon,
    color: "text-muted-foreground"
  },
  feedback: { icon: MessageCircleIcon, color: "text-amber-600" },
  "ai-generation": { icon: SparklesIcon, color: "text-ai" },
  "ai-revision": { icon: SparklesIcon, color: "text-ai" },
  "definition-created": { icon: FilePlusIcon, color: "text-purple-600" },
  "definition-edited": { icon: PencilIcon, color: "text-purple-600" },
  comment: { icon: MessageSquareIcon, color: "text-amber-600" },
  vote: { icon: ThumbsUpIcon, color: "text-teal-600" },
  "refine-requested": { icon: WandSparklesIcon, color: "text-primary" },
  "refine-suggested": { icon: SparklesIcon, color: "text-ai" },
  "refine-accepted": { icon: CheckIcon, color: "text-green-600" },
  "refine-kept": { icon: UndoIcon, color: "text-muted-foreground" },
  "refine-failed": { icon: TriangleAlertIcon, color: "text-destructive" }
}

export const ProvenanceTimeline = ({ events }: { events: ProvEvent[] }) => (
  <ol className="relative border-l ml-3 space-y-6">
    {events.map((event) => {
      const { icon: Icon, color } = KIND[event.kind]

      return (
        <li key={event.id} className="ml-6">
          <span className="absolute -left-[13px] bg-background border rounded-full p-1">
            <Icon className={`size-4 ${color}`} />
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{event.summary}</span>
            {/* when a model badge is shown the actor would duplicate it */}
            {event.actorKind !== "unknown" && !event.model && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {event.actorKind === "software" ? (
                  <BotIcon className="size-3.5" />
                ) : (
                  <UserIcon className="size-3.5" />
                )}
                {event.profileUserId ? (
                  <PublicProfileName
                    user={{
                      id: event.profileUserId,
                      name: event.actor,
                      isAi: false,
                      isProfilePublic: true
                    }}
                  />
                ) : (
                  event.actor
                )}
              </span>
            )}
            {/* human is the unmarked case; badge the recorded kind only when
                it is not what a reader would assume */}
            {event.agency && event.agency !== "human" && (
              <Badge className="!py-0 bg-ai/15 text-ai border-ai/30">
                {event.agency}
              </Badge>
            )}
            {event.model && (
              <Badge className="!py-0 font-mono bg-ai/15 text-ai border-ai/30">
                {event.model}
              </Badge>
            )}
            {event.promptRef && (
              <Badge variant="outline" className="!py-0 font-mono">
                {event.promptRef}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(event.at)}
          </p>
          {event.detail && (
            <ProvDetail
              text={event.detail}
              className="mt-1 p-2 bg-accent rounded-md"
            />
          )}
        </li>
      )
    })}
  </ol>
)
