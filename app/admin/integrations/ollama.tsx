"use client";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/trpc/client";

export const TestOllama = () => {
  const [data] = trpc.admin.ollama.useSuspenseQuery();

  return (
    <Card>
      <section className="flex items-center justify-between px-6">
        <CardTitle>Ollama</CardTitle>
        <div className="flex items-center gap-2">
          {data.ok ? (
            <>
              <div className="size-3 rounded-full bg-green-500" /> Ready
            </>
          ) : (
            <>
              <div className="size-3 rounded-full bg-red-500" /> Error
            </>
          )}
        </div>
      </section>
      <Separator />
      <CardContent>
        {data.ok ? (
          <>
            <p>Family: {data?.model.details.family}</p>
            <p>Parameters: {data?.model.details.parameter_size}</p>
          </>
        ) : (
          data.message
        )}
      </CardContent>
    </Card>
  );
};
