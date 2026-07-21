"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Button } from "../ui/button";
import { trpc } from "@/trpc/client";
import { Skeleton } from "../ui/skeleton";
import { Card, CardContent } from "../ui/card";
import { formatDateTime } from "@/lib/date";

interface Props {
  id: number;
}

export const TermVotesFallback = () => {
  return (
    <div className="flex flex-col items-center">
      <Button variant="ghost" disabled>
        <ArrowUpIcon />
      </Button>
      <Skeleton className="w-6 h-4" />
      <Button variant="ghost" disabled>
        <ArrowDownIcon />
      </Button>
    </div>
  );
};

export const TermComments = ({ id }: Props) => {
  const [comments] = trpc.comments.get.useSuspenseQuery(id);

  return (
    <div className="flex flex-col gap-2">
      {comments.map((comment) => (
        <Card key={comment.id}>
          <CardContent>
            <section>
              <p>{comment.author.name}
                <a className="text-xs"> {formatDateTime(comment.createdAt)}</a>
              </p>

            </section>
            <p>{comment.message}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
