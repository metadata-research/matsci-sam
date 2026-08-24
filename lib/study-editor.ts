export const STUDY_TITLE_MAX = 120
export const STUDY_INSTRUCTIONS_MAX = 2_000

export type StudyEditorStep = {
  kind: string
  position: number
}

export type StudyEditorUsage = {
  completions: number
  responses: number
  definitionRevisions: number
  voteEvents: number
  comments: number
}

export type InstructionEditabilityInput = {
  steps: StudyEditorStep[]
  usage: StudyEditorUsage
}

export type InstructionEditability = {
  editable: boolean
  reason: string | null
  activity: number
}

/**
 * Instructions are stored and rendered as plain text. Trimming only the outer
 * whitespace keeps paragraph breaks and literal Markdown/HTML intact.
 */
export const normalizeStudyInstructions = (value: string): string | null => {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** Convert a datetime-local control value, interpreted as UTC, to ISO. */
export const localDateTimeToIso = (value: string): string | null => {
  const normalized = value.trim()
  if (normalized.length === 0) return null

  const match = LOCAL_DATE_TIME_PATTERN.exec(normalized)
  if (!match) throw new RangeError("Enter a valid local date and time.")

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  )
    throw new RangeError("Enter a valid local date and time.")

  return date.toISOString()
}

const padDatePart = (value: number) => String(value).padStart(2, "0")

/** Convert an ISO timestamp to a UTC datetime-local value at minute precision. */
export const isoToLocalDateTime = (value: string | null): string => {
  if (value === null || value.trim().length === 0) return ""

  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new RangeError("Enter a valid ISO date and time.")

  return `${date.getUTCFullYear()}-${padDatePart(
    date.getUTCMonth() + 1
  )}-${padDatePart(date.getUTCDate())}T${padDatePart(
    date.getUTCHours()
  )}:${padDatePart(date.getUTCMinutes())}`
}

/** Return a form-ready error when a study window is invalid. */
export const studyWindowError = (
  opensAt: string | null,
  closesAt: string | null
): string | null => {
  if (opensAt === null || closesAt === null) return null

  const opens = Date.parse(opensAt)
  const closes = Date.parse(closesAt)
  if (Number.isNaN(opens) || Number.isNaN(closes))
    return "Enter valid opening and closing dates."
  if (closes <= opens) return "The closing date must be after the opening date."

  return null
}

export const instructionEditability = ({
  steps,
  usage
}: InstructionEditabilityInput): InstructionEditability => {
  const activity = Object.values(usage).reduce(
    (total, count) => total + count,
    0
  )

  if (activity > 0)
    return {
      editable: false,
      reason: `Instructions are locked because this walkthrough has ${activity} recorded activity ${activity === 1 ? "item" : "items"}.`,
      activity
    }

  if (steps.length === 0) return { editable: true, reason: null, activity }

  const instructionSteps = steps.filter((step) => step.kind === "instructions")
  if (instructionSteps.length !== 1 || instructionSteps[0].position !== 1)
    return {
      editable: false,
      reason:
        "Instructions are locked because the walkthrough must have exactly one instructions step at position 1.",
      activity
    }

  return { editable: true, reason: null, activity }
}
