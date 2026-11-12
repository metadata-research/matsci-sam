import { CircleHelpIcon } from "lucide-react"
import { HeaderNavLink } from "@/components/header-navigation"
import styles from "./header.module.css"

export function HelpLink() {
  return (
    <HeaderNavLink
      href="/docs/guide"
      activePaths={["/docs"]}
      className={`${styles.navButton} ${styles.helpButton}`}
    >
      <CircleHelpIcon aria-hidden className="size-4" />
      Help
    </HeaderNavLink>
  )
}
