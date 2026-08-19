"use client"

import { useState } from "react"
import { CheckIcon, Edit2Icon } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import type { ConceptRow } from "@/lib/kos"

interface Props {
  termId: number
  // Every facet a curator may assign, resolved on the server. Passing the
  // list rather than querying for it keeps the popover instant and avoids a
  // second public endpoint.
  options: ConceptRow[]
}

const byName = (a: ConceptRow, b: ConceptRow) =>
  a.name.localeCompare(b.name, "en")

/*
 * Curator control for term-level facets. Rendered only for administrators;
 * tags.setFacet is an admin procedure, so this is an affordance rather than
 * the enforcement. The facet list it writes to is the one the chip row reads.
 */
export const FacetEditor = ({ termId, options }: Props) => {
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [facets] = trpc.tags.facets.useSuspenseQuery({ termId })

  const { mutate: setFacet } = trpc.tags.setFacet.useMutation({
    onMutate: async ({ conceptId, on }) => {
      // Cancel first: an in-flight refetch would otherwise land after this
      // write and undo it.
      await utils.tags.facets.cancel({ termId })
      const old = utils.tags.facets.getData({ termId })
      if (!old) return

      if (!on)
        return utils.tags.facets.setData({ termId }, () =>
          old.filter((facet) => facet.id !== conceptId)
        )

      const added = options.find((option) => option.id === conceptId)
      if (!added) return
      utils.tags.facets.setData({ termId }, () => [...old, added].sort(byName))
    },
    onError: (error) => {
      toast.error(error.message)
      utils.tags.facets.refetch({ termId })
    }
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="!p-1 !h-min">
          <Edit2Icon className="size-4 text-primary" />
          <span className="sr-only">Edit facets</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search facets..." />
          <CommandList>
            <CommandEmpty>No facets found</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const on = facets.some((facet) => facet.id === option.id)

                return (
                  <CommandItem
                    key={option.id}
                    // Unique per scheme, so two schemes may share a label
                    // without the two rows selecting together.
                    value={`${option.schemeSlug}/${option.slug}`}
                    keywords={[option.name]}
                    className="cursor-pointer"
                    onSelect={() =>
                      setFacet({ termId, conceptId: option.id, on: !on })
                    }
                  >
                    <CheckIcon className={on ? "opacity-100" : "opacity-0"} />
                    {option.name}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
