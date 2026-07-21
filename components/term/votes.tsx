"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import { toast } from "sonner";
import Link from "next/link";
import { useEffect, useRef } from "react";

interface Props {
  definitionId: number;
  initial: {
    score: number;
    vote: "up" | "down" | null;
  };
  // Fired whenever this definition's score changes, so a parent list can
  // re-sort. Optional; most callers do not reorder.
  onScoreChange?: (score: number) => void;
}

export const TermVotes = ({ definitionId, initial, onScoreChange }: Props) => {
  const { data, refetch } = trpc.votes.get.useQuery({ definitionId }, { initialData: initial })

  // Report score changes up without re-subscribing the effect on every render:
  // the callback lives in a ref, the effect depends only on the score.
  //
  // votes.get computes score as SUM(...), a bigint the driver returns as a
  // string (and null when a definition has no votes), so coerce it. null means
  // no votes, which the display renders as 0 -- match that for sorting.
  const cbRef = useRef(onScoreChange)
  cbRef.current = onScoreChange
  useEffect(() => {
    cbRef.current?.(data?.score == null ? 0 : Number(data.score))
  }, [data?.score])

  const { isPending, mutate } = trpc.votes.vote.useMutation({
    onSuccess: () => refetch(),
    onError: () => toast("You must be logged in to vote on a definition!", {
      action: <Link href="/api/login" className="ml-auto">
        <Button>Login</Button>
      </Link>,
      position: 'top-center'
    })
  })

  return (
    // The whole definition card is a <Link>. A disabled Button has
    // pointer-events:none, so a click during a pending vote falls through to
    // the anchor and navigates. Cancel navigation here on the rail itself,
    // which never disables, so it catches the click either way.
    <Card
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="flex flex-col items-center !p-1 !gap-1 h-min rounded-full"
    >
      <Button
        className={cn(
          "rounded-t-full !px-2 !pb-1",
          data?.vote === "up" ? "text-primary" : "",
        )}
        disabled={isPending}
        onClick={(e) => {
          e.preventDefault();
          mutate({ vote: "up", definitionId });
        }}
        variant="ghost"
      >
        <ArrowUpIcon />
      </Button>
      <span className="font-bold">{data?.score || 0}</span>
      <Button
        className={cn(
          "rounded-b-full !px-2 !pt-1",
          data?.vote === "down" ? "text-primary" : "",
        )}
        disabled={isPending}
        onClick={(e) => {
          e.preventDefault();
          mutate({ vote: "down", definitionId });
        }}
        variant="ghost"
      >
        <ArrowDownIcon />
      </Button>
    </Card>
  );
};
