"use client";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { trpc } from "@/trpc/client";
import type { RouterOutput } from "@/trpc/trpc-helpers";
import { Button } from "@/components/ui/button";
import { PlayIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Job = RouterOutput["admin"]["terms"][number];
const columns: ColumnDef<Job>[] = [
  {
    id: "term",
    cell: ({ row }) => (
      <Link href={`/admin/terms/${row.original.id}`}>{row.original.term}</Link>
    ),
    header: "Term",
  },
  {
    id: "model",
    header: "Model",
    cell: ({ row }) =>
      row.original.model && (
        <Badge variant="secondary" className="font-mono">
          {row.original.model}
        </Badge>
      ),
  },
  {
    id: "run",
    header: "Run",
    cell: ({ row, table }) => {
      if (!row.original.pending) return null;

      const { mutate, isPending } = trpc.admin.run.useMutation({
        // @ts-expect-error -----
        onSuccess: () => table.options.meta!.router!.refresh(),
      });

      return (
        <Button
          disabled={isPending}
          onClick={() => mutate(row.original.id)}
          variant="ghost"
          className="!p-1 !h-min"
        >
          <PlayIcon className="size-4" />
        </Button>
      );
    },
  },
];

export function JobsTable() {
  const router = useRouter();

  const { data } = trpc.admin.terms.useQuery(undefined, {
    initialData: [],
  });

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: { router },
  });

  return (
    <Card className="bg-card !py-0">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
