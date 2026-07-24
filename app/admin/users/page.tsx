import { trpc } from "@/trpc/server"
import { UsersTable } from "./table"
import { AdminPageHeader } from "../page-header"

export default async function AdminUsersPage() {
  const users = await trpc.admin.users()

  return (
    <>
      <AdminPageHeader
        title="People"
        description="Find contributor accounts and manage administrative roles."
      />
      <UsersTable initialData={users} />
    </>
  )
}
