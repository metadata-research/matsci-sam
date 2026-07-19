import { Badge } from "@/components/ui/badge";
import type { ProvEvent } from "@/lib/provenance";
import { format } from "date-fns";
import {
  BotIcon,
  FilePlusIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PencilIcon,
  SparklesIcon,
  TagIcon,
  ThumbsUpIcon,
  UserIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const KIND: Record<
  ProvEvent["kind"],
  { icon: LucideIcon; color: string }
> = {
  "term-created": { icon: TagIcon, color: "text-green-600" },
  "initial-message": { icon: MessageCircleIcon, color: "text-muted-foreground" },
  feedback: { icon: MessageCircleIcon, color: "text-amber-600" },
  "ai-generation": { icon: SparklesIcon, color: "text-blue-600" },
  "ai-revision": { icon: BotIcon, color: "text-blue-600" },
  "definition-created": { icon: FilePlusIcon, color: "text-purple-600" },
  "definition-edited": { icon: PencilIcon, color: "text-purple-600" },
  comment: { icon: MessageSquareIcon, color: "text-amber-600" },
  vote: { icon: ThumbsUpIcon, color: "text-teal-600" },
};

export const ProvenanceTimeline = ({ events }: { events: ProvEvent[] }) => (
  <ol className="relative border-l ml-3 space-y-6">
    {events.map((event) => {
      const { icon: Icon, color } = KIND[event.kind];

      return (
        <li key={event.id} className="ml-6">
          <span className="absolute -left-[13px] bg-background border rounded-full p-1">
            <Icon className={`size-4 ${color}`} />
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{event.summary}</span>
            {event.actorKind !== "unknown" && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {event.actorKind === "software" ? (
                  <BotIcon className="size-3.5" />
                ) : (
                  <UserIcon className="size-3.5" />
                )}
                {event.actor}
              </span>
            )}
            {event.model && (
              <Badge variant="secondary" className="!py-0 font-mono">
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
            {format(event.at, "MM/dd/yyyy h:mm aaa")}
          </p>
          {event.detail && (
            <pre className="text-sm text-wrap font-sans mt-1 p-2 bg-accent rounded-md">
              {event.detail}
            </pre>
          )}
        </li>
      );
    })}
  </ol>
);
