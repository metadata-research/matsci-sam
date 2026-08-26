import Link from "next/link"
import { BookOpenIcon, FilePlus2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TERM_MAX_LENGTH } from "@/lib/input-limits"
import styles from "./home.module.css"

export function DefinitionStarter({
  signedIn,
  vocabularyTitle
}: {
  signedIn: boolean
  vocabularyTitle: string
}) {
  return (
    <>
      <p className={styles.contributionIntro}>
        Add a term and its first definition to the {vocabularyTitle} vocabulary.
        Open an existing term to add a definition, example, or comment.
      </p>

      {signedIn ? (
        <form className={styles.definitionStarter} action="/add" method="get">
          <label htmlFor="home-definition-term">Term</label>
          <div className={styles.definitionStarterRow}>
            <Input
              id="home-definition-term"
              name="term"
              type="text"
              required
              maxLength={TERM_MAX_LENGTH}
              autoComplete="off"
              placeholder="For example, grain boundary"
            />
            <Button type="submit">
              <FilePlus2Icon aria-hidden />
              Continue
            </Button>
          </div>
          <p className={styles.contributionNote}>
            Next, write the first definition or prompt a language model to draft
            an editable suggestion.
          </p>
        </form>
      ) : (
        <p className={styles.contributionNote}>
          Sign in to add a term and its first definition.
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
            Browse terms
          </Link>
        </Button>
      </div>
    </>
  )
}
