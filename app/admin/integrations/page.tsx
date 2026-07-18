import { HydrateClient, trpc } from "@/trpc/server";
import { Suspense } from "react";
import { TestOllama } from "./ollama";
import { WolframCard } from "./wolfram";

export default async function AdminIntegrationsPage() {
  void trpc.admin.ollama.prefetch();
  void trpc.admin.integrations.prefetch();

  return (
    <HydrateClient>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          External services the app connects to.
        </p>
        <Suspense fallback={null}>
          <TestOllama />
        </Suspense>
        <Suspense fallback={null}>
          <WolframCard />
        </Suspense>
      </div>
    </HydrateClient>
  );
}
