"use client";

import { trpc } from "@/trpc/client";
import { Badge } from "../ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { CheckIcon, Edit2Icon } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { useState } from "react";

interface Props {
  definitionId: number;
}

export const EditTags = ({ definitionId }: Props) => {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  // Query the tags that are already selected
  const [selectedTags] = trpc.tags.get.useSuspenseQuery({ definitionId });

  // Query to fetch all tags
  const { data: availableTags } = trpc.tags.getAll.useQuery(undefined, {
    enabled: open,
  });

  // Mutation to toggle a tag
  const { mutate: toggleTag } = trpc.tags.toggle.useMutation({
    onMutate: ({ definitionId, tagId }) => {
      // get the old selected tags data
      const old = utils.tags.get.getData({ definitionId });
      if (!old) return;

      // check if we will be removing or adding the tag
      const isRemovingTag = old?.some((t) => t.id === tagId);
      if (isRemovingTag)
        // optimistically filter out this tag from the selected tags
        return utils.tags.get.setData({ definitionId }, () =>
          old.filter((t) => t.id !== tagId),
        );

      // otherwise, we are adding the tag
      // find the tag we are adding
      const tag = utils.tags.getAll.getData()?.find((tag) => tag.id === tagId);
      if (!tag) return;

      // add it to the selected tags
      utils.tags.get.setData({ definitionId }, () => [...old, tag]);
    },
    // if mutation throws error, refetch to get the actual state
    onError: () => utils.tags.get.refetch({ definitionId: definitionId }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="!p-1 !h-min">
          <Edit2Icon className="size-4 text-primary" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Search Tags..." />
          <CommandEmpty>No tags found</CommandEmpty>
          <CommandGroup>
            {availableTags?.map((tag) => (
              <CommandItem
                key={tag.id}
                value={tag.name}
                onSelect={() => toggleTag({ definitionId, tagId: tag.id })}
              >
                <CheckIcon
                  className={
                    selectedTags.some((t) => t.id === tag.id)
                      ? "opacity-100"
                      : "opacity-0"
                  }
                />
                <Badge>{tag.name}</Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
