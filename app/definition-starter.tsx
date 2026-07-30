import Link from "next/link"
import { BookOpenIcon, FilePlus2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TERM_MAX_LENGTH } from "@/lib/input-limits"
import styles from "./home.module.css"

type SuggestedTerm = {
  id: number
  term: string
}

export function DefinitionStarter({
  signedIn,
  terms
}: {
  signedIn: boolean
  terms: SuggestedTerm[]
}) {
  return (
    <>
      <p className={styles.contributionIntro}>
        Add another perspective to an existing term, or introduce one the
        vocabulary is missing.
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
              list="home-materials-terms"
              required
              maxLength={TERM_MAX_LENGTH}
              autoComplete="off"
              placeholder="e.g., grain boundary"
            />
            <datalist id="home-materials-terms">
              {terms.map((term) => (
                <option key={term.id} value={term.term} />
              ))}
            </datalist>
            <Button type="submit">
              <FilePlus2Icon aria-hidden />
              Start a definition
            </Button>
          </div>
          <p className={styles.contributionNote}>
            Choose a suggested term or enter a new one. Next, write the
            definition, add an example of use, and choose how AI should assist.
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
