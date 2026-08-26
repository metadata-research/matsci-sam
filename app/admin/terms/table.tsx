"use client"

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { trpc } from "@/trpc/client"
import { termPath } from "@/lib/public-identifiers"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  BotIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  PlayIcon,
  SearchIcon
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import styles from "../admin.module.css"

type Job = RouterOutput["admin"]["terms"][number]

const vocabularyColumns: ColumnDef<Job>[] = [
  {
    id: "term",
    accessorKey: "term",
    header: "Term",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Link
          href={`/admin/terms/${row.original.id}`}
          className="font-serif font-semibold hover:text-primary hover:underline"
        >
          {row.original.term}
        </Link>
        <Link
          href={termPath(row.original.slug, row.original.vocabularySlug)}
          aria-label={`Open public record for ${row.original.term}`}
          className="text-muted-foreground hover:text-primary"
        >
          <ExternalLinkIcon aria-hidden className="size-3.5" />
        </Link>
      </div>
    )
  },
  {
    id: "definitions",
    accessorKey: "definitions",
    header: "Definitions",
    enableGlobalFilter: false,
    cell: ({ row }) =>
      row.original.definitions > 0 ? (
        <span className={styles.tableMetric}>{row.original.definitions}</span>
      ) : (
        <span className={styles.tableMetricEmpty}>—</span>
      )
  },
  {
    id: "aiDefinitions",
    accessorKey: "aiDefinitions",
    header: "AI-authored",
    enableGlobalFilter: false,
    cell: ({ row }) =>
      row.original.aiDefinitions > 0 ? (
        <span className={styles.tableMetricAi}>
          <BotIcon aria-hidden className="size-4" />{" "}
          {row.original.aiDefinitions}
        </span>
      ) : (
        <span className={styles.tableMetricEmpty}>—</span>
      )
  },
  {
    id: "comments",
    accessorKey: "comments",
    header: "Comments",
    enableGlobalFilter: false,
    cell: ({ row }) =>
      row.original.comments > 0 ? (
        <Link
          href={termPath(row.original.slug, row.original.vocabularySlug)}
          aria-label={`${row.original.comments} ${
            row.original.comments === 1 ? "comment" : "comments"
          } on ${row.original.term}`}
          className={styles.tableMetricLink}
        >
          <MessageSquareIcon aria-hidden className="size-4" />{" "}
          {row.original.comments}
        </Link>
      ) : (
        <span className={styles.tableMetricEmpty}>—</span>
      )
  }
]

const actionColumn: ColumnDef<Job> = {
  id: "run",
  header: "Action",
  enableGlobalFilter: false,
  cell: ({ row }) => <RunJobButton job={row.original} />
}

const reviewColumns: ColumnDef<Job>[] = [...vocabularyColumns, actionColumn]

function RunJobButton({ job }: { job: Job }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { mutate, isPending } = trpc.admin.run.useMutation({
    onSuccess: async () => {
      await utils.admin.terms.invalidate()
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  if (!job.pending)
    return <span className="text-xs text-muted-foreground">Up to date</span>

  return (
    <Button
      disabled={isPending}
      onClick={() => mutate(job.id)}
      variant="ghost"
      size="sm"
      aria-label={`Run AI generation for ${job.term}`}
    >
      <PlayIcon aria-hidden className="size-4" />
      {isPending ? "Running" : "Run"}
    </Button>
  )
}

export function JobsTable({
  pendingOnly = false,
  initialData,
  showActions = false
}: {
  pendingOnly?: boolean
  initialData?: Job[]
  showActions?: boolean
}) {
  const [filter, setFilter] = useState("")
  const query = trpc.admin.terms.useQuery(
    undefined,
    initialData ? { initialData } : undefined
  )
  const data = query.data ?? initialData ?? []

  const visibleData = pendingOnly ? data.filter((job) => job.pending) : data
  const columns = showActions ? reviewColumns : vocabularyColumns
  const table = useReactTable({
    data: visibleData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter
  })
  const rows = table.getRowModel().rows

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <label className={styles.toolbarSearch}>
          <span className="sr-only">Search vocabulary administration</span>
          <SearchIcon aria-hidden />
          <Input
            type="search"
            suppressHydrationWarning
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search terms"
          />
        </label>
        <span className={styles.toolbarMeta} aria-live="polite">
          {rows.length} {rows.length === 1 ? "term" : "terms"}
        </span>
      </div>
      <Table
        className={styles.recordTable}
        aria-label={
          showActions
            ? "Term-level AI generation queue"
            : "Vocabulary administration"
        }
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} scope="col">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.id} className={styles.recordTableRow}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    data-label={
                      typeof cell.column.columnDef.header === "string"
                        ? cell.column.columnDef.header
                        : undefined
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {filter
                  ? `No terms match "${filter}".`
                  : pendingOnly
                    ? "No AI generation jobs are waiting."
                    : "No vocabulary records are available."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  )
}
