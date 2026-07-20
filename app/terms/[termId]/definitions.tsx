"use client";

import { Definition } from "@/components/definition";
import { trpc } from "@/trpc/client";

export const DefinitionList = ({ termId }: { termId: number }) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId });

  return definitions.map((definition, i) => (
    <Definition
      key={definition.id}
      definition={definition}
      // The server returns them highest-voted first (newest breaking ties), so
      // the leading row is the term's default. Only marked when there is more
      // than one -- with a single definition the label distinguishes nothing.
      isDefault={i === 0 && definitions.length > 1}
    />
  ));
};
