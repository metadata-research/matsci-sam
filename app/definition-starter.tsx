"use client"

import Link from "next/link"
import { FilePlus2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TermAutocomplete } from "@/components/term-autocomplete"
import { TERM_MAX_LENGTH } from "@/lib/input-limits"
import { trpc } from "@/trpc/client"
import styles from "./home.module.css"

export function DefinitionStarter({
  signedIn,
  vocabularyTitle
}: {
  signedIn: boolean
  vocabularyTitle: string
}) {
  const vocabulary = trpc.terms.list.useQuery(undefined, { enabled: signedIn })

  return (
    <>
      <p className={styles.contributionIntro}>
        Add a term and its first definition to the {vocabularyTitle} vocabulary.
      </p>

      {signedIn ? (
        <form className={styles.definitionStarter} action="/add" method="get">
          <label htmlFor="home-definition-term">Term</label>
          <div className={styles.definitionStarterRow}>
            <TermAutocomplete
              id="home-definition-term"
              name="term"
              type="text"
              required
              maxLength={TERM_MAX_LENGTH}
              autoComplete="off"
              options={vocabulary.data?.terms ?? []}
              placeholder="For example, grain boundary"
            />
            <Button type="submit">
              <FilePlus2Icon aria-hidden />
              Continue
            </Button>
          </div>
          {vocabulary.error && (
            <p role="status" className={styles.contributionNote}>
              Suggestions are unavailable. You can still enter a term and
              continue.
            </p>
          )}
          <p className={styles.contributionNote}>
            Next, write the first definition or prompt a language model to draft
            an editable suggestion.
          </p>
        </form>
      ) : (
        <div className={styles.contributionActions}>
          <Button asChild>
            <Link href="/login">
              <FilePlus2Icon aria-hidden />
              Sign in to contribute
            </Link>
          </Button>
        </div>
      )}
    </>
  )
}
