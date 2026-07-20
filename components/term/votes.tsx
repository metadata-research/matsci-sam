"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import { toast } from "sonner";
import Link from "next/link";

interface Props {
  definitionId: number;
  initial: {
    score: number;
    vote: "up" | "down" | null;
  };
}

export const TermVotes = ({ definitionId, initial }: Props) => {
  const { data, refetch } = trpc.votes.get.useQuery({ definitionId }, { initialData: initial })

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
    <Card className="flex flex-col items-center !p-1 !gap-1 h-min rounded-full">
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
