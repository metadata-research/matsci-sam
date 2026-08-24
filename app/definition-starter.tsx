import Link from "next/link"
import { BookOpenIcon, FilePlus2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TERM_MAX_LENGTH } from "@/lib/input-limits"
import styles from "./home.module.css"

export function DefinitionStarter({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <p className={styles.contributionIntro}>
        Introduce a materials science term the vocabulary is missing. To revise,
        replace, comment on, or add an example to an existing term, open its
        vocabulary page.
      </p>

      {signedIn ? (
        <form className={styles.definitionStarter} action="/add" method="get">
          <label htmlFor="home-definition-term">
            Start with a materials term
          </label>
          <div className={styles.definitionStarterRow}>
            <Input
              id="home-definition-term"
              name="term"
              type="text"
              required
              maxLength={TERM_MAX_LENGTH}
              autoComplete="off"
              placeholder="e.g., grain boundary"
            />
            <Button type="submit">
              <FilePlus2Icon aria-hidden />
              Start a new term
            </Button>
          </div>
          <p className={styles.contributionNote}>
            Next, write the first definition yourself or ask AI for an editable
            suggestion. Examples are added separately after publication.
          </p>
        </form>
      ) : (
        <p className={styles.contributionNote}>
          Sign in first so your contribution and any later revisions can be
          attributed to you.
        </p>
      )}

      <div className={styles.contributionActions}>
        {signedIn ? null : (
          <Button asChild>
            <Link href="/login">
              <FilePlus2Icon aria-hidden />
              Sign in to contribute
            </Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/terms">
            <BookOpenIcon aria-hidden />
            Browse all terms
          </Link>
        </Button>
      </div>
    </>
  )
}
