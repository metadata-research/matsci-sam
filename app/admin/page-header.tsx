import type { ReactNode } from "react"
import { AdminNav } from "./nav"
import styles from "./admin.module.css"

export function AdminPageHeader({
  title,
  description,
  actions
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.sectionHeading}>
        <div>
          <h1 className={styles.pageTitle}>{title}</h1>
          <p className={styles.pageDescription}>{description}</p>
        </div>
        {actions}
      </div>
      <div className={styles.mobileNavigation}>
        <AdminNav />
      </div>
    </header>
  )
}
