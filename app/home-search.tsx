import { TermSearch } from "@/components/term-search"
import styles from "./home.module.css"

export function HomeSearch({
  showScope,
  viewerId
}: {
  showScope: boolean
  viewerId: number | null
}) {
  return (
    <section className={styles.findPanel} aria-labelledby="find-heading">
      <h2 id="find-heading">Find a term</h2>
      <TermSearch inputId="home-search" viewerId={viewerId} />
      {showScope ? (
        <p className={styles.contributionNote}>
          Search includes all vocabularies.
        </p>
      ) : null}
    </section>
  )
}
