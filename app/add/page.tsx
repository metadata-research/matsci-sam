import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Add Definition | ${SITE_NAME}` }
import { auth } from "@/lib/auth";
import { DefineTermForm } from "./form";
import { HydrateClient, trpc } from "@/trpc/server";

export default async function AddTermPage() {
  await auth();
  await trpc.terms.list.prefetch(undefined);

  return (
    <HydrateClient>
      <main className="flex-1 px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-4">
            <h1 className="text-3xl font-bold leading-none">Define a Term</h1>
            <p className="text-secondary-foreground mt-2">
              Add a materials science term with your definition and an example
              of its use. Definitions are public. Others can vote on them,
              comment, and add alternatives of their own.
            </p>
          </div>
          <DefineTermForm />
        </div>
      </main>
    </HydrateClient>
  );
}
