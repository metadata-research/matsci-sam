"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckCircle2Icon,
  MessageSquarePlusIcon,
  SendIcon,
  XIcon
} from "lucide-react"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_PAGE_PATH_MAX_LENGTH
} from "@/lib/input-limits"
import { trpc } from "@/trpc/client"
import styles from "./feedback-widget.module.css"

export const FeedbackWidget = ({ identity }: { identity: string }) => {
  const pathname = usePathname()
  const pagePath = (pathname || "/").slice(0, FEEDBACK_PAGE_PATH_MAX_LENGTH)

  // Root layouts persist through client navigation. Keying the page-specific
  // form closes it and discards its draft when the pathname changes, so a
  // comment cannot silently acquire the destination page as its context.
  return (
    <PageFeedbackWidget
      key={pathname || "/"}
      identity={identity}
      pagePath={pagePath}
    />
  )
}

const PageFeedbackWidget = ({
  identity,
  pagePath
}: {
  identity: string
  pagePath: string
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const submit = trpc.feedback.submit.useMutation({
    onSuccess: () => {
      setMessage("")
      setSubmitted(true)
    }
  })

  useEffect(() => {
    if (!isOpen || submitted) return

    textareaRef.current?.focus()
  }, [isOpen, submitted])

  const open = () => {
    setSubmitted(false)
    submit.reset()
    setIsOpen(true)
  }

  const close = () => {
    setIsOpen(false)
    setSubmitted(false)
    submit.reset()
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div className={styles.positioner}>
      {!isOpen ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className={styles.trigger}
          aria-label="Feedback"
          aria-expanded="false"
          aria-controls="interface-feedback-panel"
          onClick={open}
        >
          <MessageSquarePlusIcon aria-hidden />
          <span className={styles.triggerLabel}>Feedback</span>
        </Button>
      ) : (
        <aside
          id="interface-feedback-panel"
          className={styles.panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="interface-feedback-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") close()
          }}
        >
          <div className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Interface feedback</p>
              <h2 id="interface-feedback-title" className={styles.title}>
                Share feedback
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={styles.close}
              aria-label="Close feedback form"
              onClick={close}
            >
              <XIcon aria-hidden />
            </Button>
          </div>

          {submitted ? (
            <div className={styles.success} role="status">
              <CheckCircle2Icon aria-hidden />
              <p>Thanks — your feedback was saved with this page.</p>
              <Button type="button" variant="outline" size="sm" onClick={close}>
                Done
              </Button>
            </div>
          ) : (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                const formData = new FormData(event.currentTarget)
                const website = String(formData.get("website") ?? "")
                const trimmedMessage = message.trim()

                if (trimmedMessage.length < FEEDBACK_MESSAGE_MIN_LENGTH) return

                submit.mutate({
                  message: trimmedMessage,
                  pagePath,
                  website
                })
              }}
            >
              <p className={styles.intro}>
                Tell us what is confusing, missing, or working well.
              </p>

              <div className={styles.context}>
                <span>
                  Sending as <strong>{identity}</strong>
                </span>
                <span className={styles.location} title={pagePath}>
                  Page: {pagePath}
                </span>
              </div>

              <div className={styles.field}>
                <label htmlFor="interface-feedback-message">
                  What should we improve?
                </label>
                <Textarea
                  ref={textareaRef}
                  id="interface-feedback-message"
                  name="message"
                  value={message}
                  minLength={FEEDBACK_MESSAGE_MIN_LENGTH}
                  maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                  rows={5}
                  required
                  placeholder="A brief note is enough."
                  onChange={(event) => {
                    setMessage(event.target.value)
                    if (submit.error) submit.reset()
                  }}
                />
                <span className={styles.counter}>
                  {message.length} / {FEEDBACK_MESSAGE_MAX_LENGTH}
                </span>
              </div>

              <div className={styles.honeypot} aria-hidden="true">
                <label htmlFor="interface-feedback-website">Website</label>
                <input
                  id="interface-feedback-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              {submit.error && (
                <p className={styles.error} role="alert">
                  Your feedback could not be saved. Please try again.
                </p>
              )}

              <div className={styles.actions}>
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    submit.isPending ||
                    message.trim().length < FEEDBACK_MESSAGE_MIN_LENGTH
                  }
                >
                  <SendIcon aria-hidden />
                  {submit.isPending ? "Sending…" : "Send feedback"}
                </Button>
              </div>
            </form>
          )}
        </aside>
      )}
    </div>
  )
}
