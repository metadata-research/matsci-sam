"use client"

import { PlusIcon, XIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { trpc } from "@/trpc/client"

const useSetCollection = () => {
  const router = useRouter()
  return trpc.communities.setCollection.useMutation({
    onSuccess: () => router.refresh(),
    onError: (error) => toast.error(error.message)
  })
}

export const AddCollectionToCommunity = ({
  collectionId,
  communities
}: {
  collectionId: number
  communities: { id: number; title: string }[]
}) => {
  const { mutate: setCollection, isPending } = useSetCollection()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          <PlusIcon className="mr-1 size-4" />
          Add to a community
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {communities.length === 0 ? (
          <DropdownMenuItem disabled>
            This collection is already in every community you can manage.
          </DropdownMenuItem>
        ) : null}
        {communities.map((community) => (
          <DropdownMenuItem
            key={community.id}
            onSelect={() =>
              setCollection({
                communityId: community.id,
                collectionId,
                on: true
              })
            }
          >
            {community.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const RemoveCollectionFromCommunity = ({
  collectionId,
  communityId,
  communityTitle
}: {
  collectionId: number
  communityId: number
  communityTitle: string
}) => {
  const { mutate: setCollection, isPending } = useSetCollection()

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove this collection from ${communityTitle}`}
      disabled={isPending}
      onClick={() => setCollection({ communityId, collectionId, on: false })}
    >
      <XIcon className="size-4" />
    </Button>
  )
}
