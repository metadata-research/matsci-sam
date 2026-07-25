"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { formatDate } from "@/lib/date"
import { ChevronDownIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import styles from "../admin.module.css"

type AdminUser = RouterOutput["admin"]["users"][number]
type Role = AdminUser["role"]

const ROLES = ["user", "moderator", "admin"] as const

function RoleMenu({ user }: { user: AdminUser }) {
  const [proposedRole, setProposedRole] = useState<Role | null>(null)
  const utils = trpc.useUtils()
  const update = trpc.admin.updateUser.useMutation({
    onSuccess: async () => {
      await utils.admin.users.invalidate()
      setProposedRole(null)
      toast.success("Role updated")
    },
    onError: (error) => toast.error(error.message)
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={update.isPending}>
            <span className="capitalize">{user.role}</span>
            <ChevronDownIcon aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ROLES.map((role) => (
            <DropdownMenuItem
              key={role}
              disabled={role === user.role}
              onSelect={() => setProposedRole(role)}
              className="capitalize"
            >
              {role}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={proposedRole !== null}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setProposedRole(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm role change</DialogTitle>
            <DialogDescription>
              Change {user.name ?? user.email ?? "this account"} from{" "}
              <span className="font-medium text-foreground">{user.role}</span>{" "}
              to{" "}
              <span className="font-medium text-foreground">
                {proposedRole}
              </span>
              ? Role changes affect access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={update.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={!proposedRole || update.isPending}
              onClick={() => {
                if (proposedRole)
                  update.mutate({ userId: user.id, role: proposedRole })
              }}
            >
              {update.isPending ? "Updating" : "Confirm change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function UsersTable({ initialData }: { initialData: AdminUser[] }) {
  const [query, setQuery] = useState("")
  const [role, setRole] = useState<"all" | Role>("all")
  const {
    data: users,
    error,
    isFetching,
    refetch
  } = trpc.admin.users.useQuery(undefined, { initialData, retry: 1 })

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return users.filter((user) => {
      if (role !== "all" && user.role !== role) return false
      if (!normalized) return true
      return [user.name, user.email, user.role]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    })
  }, [query, role, users])

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className={styles.toolbarSearch}>
            <span className="sr-only">Search people</span>
            <SearchIcon aria-hidden />
            <Input
              type="search"
              suppressHydrationWarning
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
            />
          </label>
          <label>
            <span className="sr-only">Filter by role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as "all" | Role)}
              className="h-[2.15rem] rounded-md border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All roles</option>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className={styles.toolbarMeta}>
          {visibleUsers.length}{" "}
          {visibleUsers.length === 1 ? "account" : "accounts"}
        </span>
      </div>
      {error && (
        <div className={styles.queryNotice} role="alert">
          <span>
            The account list could not be refreshed. The last loaded data is
            still shown.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "Retrying" : "Retry"}
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right">Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleUsers.length ? (
            visibleUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {user.isProfilePublic && !user.isAi ? (
                      <Link
                        href={`/people/${user.id}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {user.name ?? "Unnamed contributor"}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {user.name ?? "Unnamed contributor"}
                      </span>
                    )}
                    {user.isAi && (
                      <Badge variant="outline" className="border-ai text-ai">
                        AI
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {user.email ?? "No email"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <time dateTime={user.createdAt}>
                    {formatDate(user.createdAt)}
                  </time>
                </TableCell>
                <TableCell className="text-right">
                  {user.isAi ? (
                    <span className="capitalize text-muted-foreground">
                      {user.role}
                    </span>
                  ) : (
                    <RoleMenu user={user} />
                  )}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                No accounts match these filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  )
}
