"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type {
  SetupCreationAttempt,
  SetupCreationMatch
} from "@/lib/setup-creation-recovery"

export function SetupCreationRecovery({
  attempt,
  matches,
  busy,
  onRefresh,
  onUseExisting,
  onRetry
}: {
  attempt: SetupCreationAttempt
  matches: SetupCreationMatch[]
  busy: boolean
  onRefresh: () => void
  onUseExisting: (match: SetupCreationMatch) => void
  onRetry: () => void
}) {
  return (
    <Alert>
      <AlertTitle>Check whether your {attempt.kind} was created</AlertTitle>
      <AlertDescription className="flex flex-col gap-4">
        <p>
          The result of the request to create &ldquo;{attempt.title}&rdquo;
          could not be confirmed. It may already have completed. Check for an
          existing {attempt.kind} before creating another.
        </p>
        {matches.length ? (
          <div className="flex flex-col gap-3">
            <p>
              These names match. Choose one if it is the one you want to use.
            </p>
            <ul className="flex flex-col gap-3">
              {matches.map((match) => (
                <li
                  key={match.href}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={match.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline [overflow-wrap:anywhere]"
                    >
                      {match.title}{" "}
                      <span className="sr-only">(opens in a new tab)</span>
                    </Link>
                    <span className="text-xs [overflow-wrap:anywhere]">
                      {match.slug}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onUseExisting(match)}
                  >
                    Use this {attempt.kind}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>No matching {attempt.kind} is currently listed.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy} onClick={onRefresh}>
            Check again
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onRetry}>
            Try creating again
          </Button>
        </div>
        <p className="text-sm">
          Trying again can create a duplicate if the earlier request completed.
        </p>
      </AlertDescription>
    </Alert>
  )
}
