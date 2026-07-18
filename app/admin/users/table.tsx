"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";
import type { RouterOutput } from "@/trpc/trpc-helpers";
import { ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";

type AdminUser = RouterOutput["admin"]["users"][number];

const ROLES = ["user", "moderator", "admin"] as const;

const useUpdateUser = () => {
  const utils = trpc.useUtils();

  return trpc.admin.updateUser.useMutation({
    onSuccess: () => utils.admin.users.invalidate(),
    onError: (err) => toast.error(err.message),
  });
};

const RoleMenu = ({ user }: { user: AdminUser }) => {
  const { mutate, isPending } = useUpdateUser();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          {user.role} <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {ROLES.map((role) => (
          <DropdownMenuItem
            key={role}
            disabled={role === user.role}
            onClick={() => mutate({ userId: user.id, role })}
          >
            {role}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const WeightInput = ({ user }: { user: AdminUser }) => {
  const { mutate } = useUpdateUser();

  const commit = (raw: string) => {
    const weight = Number(raw);
    if (raw === "" || Number.isNaN(weight) || weight < 0 || weight === user.weight)
      return;

    mutate({ userId: user.id, weight });
  };

  return (
    <Input
      key={user.weight}
      type="number"
      step="0.1"
      min="0"
      defaultValue={user.weight}
      className="w-24"
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
      }}
    />
  );
};

export function UsersTable() {
  const { data: users } = trpc.admin.users.useQuery(undefined, {
    initialData: [],
  });

  return (
    <Card className="bg-card !py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Weight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                {user.name ?? <span className="text-muted-foreground">-</span>}{" "}
                {user.isAi && <Badge variant="secondary">AI</Badge>}
              </TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                {user.isAi ? (
                  <span className="text-muted-foreground">{user.role}</span>
                ) : (
                  <RoleMenu user={user} />
                )}
              </TableCell>
              <TableCell>
                <WeightInput user={user} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
