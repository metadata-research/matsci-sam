"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/trpc/client";
import { toast } from "sonner";

const StatusDot = ({ ok }: { ok: boolean }) => (
  <div className="flex items-center gap-2">
    <div className={`size-3 rounded-full ${ok ? "bg-green-500" : "bg-gray-400"}`} />
    {ok ? "Configured" : "Not configured"}
  </div>
);

export const WolframCard = () => {
  const [{ wolfram }] = trpc.admin.integrations.useSuspenseQuery();

  const test = trpc.admin.wolframTest.useMutation({
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <section className="flex items-center justify-between px-6">
        <CardTitle>Wolfram AgentOne</CardTitle>
        <StatusDot ok={wolfram.configured} />
      </section>
      <Separator />
      <CardHeader>
        <CardDescription>
          LLM responses combined with Wolfram Language computation and curated
          knowledge. Configure with the <code>WOLFRAM_API_KEY</code> environment
          variable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {wolfram.configured ? (
          <>
            <p className="text-sm">API key: {wolfram.maskedKey}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? "Testing..." : "Test connection"}
            </Button>
            {test.data && (
              <p className="text-sm text-muted-foreground italic">
                {test.data.content}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No API key set. Add <code>WOLFRAM_API_KEY</code> to the environment
            to enable Wolfram-backed features.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
