type DateInput = Date | string | number

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric"
})

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
})

// Interpret offset-free timestamps in UTC to preserve their recorded wall time
// and keep the server and browser output identical.
const asDate = (value: DateInput) => {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
  )
    return new Date(`${value.replace(" ", "T")}Z`)
  return new Date(value)
}

export const formatDate = (value: DateInput) =>
  dateFormatter.format(asDate(value))

export const formatDateTime = (value: DateInput) => {
  const date = asDate(value)
  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)} UTC`
}
