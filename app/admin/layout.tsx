import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { AdminNav } from "./nav"
import styles from "./admin.module.css"

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  const { user } = await auth()
  if (user?.role !== "admin") redirect("/")

  return (
    <div className={styles.shell}>
      <aside className={styles.desktopRail}>
        <AdminNav />
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  )
}
