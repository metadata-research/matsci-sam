import { HydrateClient, trpc } from "@/trpc/server";
import { UsersTable } from "./table";

export default async function AdminUsersPage() {
  await trpc.admin.users.prefetch();

  return (
    <HydrateClient>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Users</h2>
        <UsersTable />
      </div>
    </HydrateClient>
  );
}
