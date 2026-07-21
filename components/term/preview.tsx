"use client";

import type { Definition } from "@yamz/db";
import { formatDate } from "@/lib/date";

interface Props {
  definition: Definition;
}

export const TermDefinition = ({ definition }: Props) => {
  return (
    <section className="flex-1">
      <div>
        <span className="italic">Definition: </span>
        {definition.definition}
      </div>
      <div>
        <span className="italic">Example: </span>
        {definition.example}
      </div>
    </section>
  );
};

export const TermMetadata = ({ definition }: Props) => (
  <section>
    <div>
      <span className="italic">Created: </span>
      {formatDate(definition.createdAt)}
    </div>
    {definition.updatedAt && (
      <div>
        <span className="italic">Last Updated: </span>
        {formatDate(definition.updatedAt)}
      </div>
    )}
  </section>
);
