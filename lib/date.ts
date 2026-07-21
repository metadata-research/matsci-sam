import { format } from "date-fns"

/*
 * One date format across every view: month abbreviation, day, year --
 * "Jul 20, 2026". Chosen to be unambiguous: a numeric form like 07/20/2026 or
 * 2026-07-20 reads differently to a European audience (day/month order), and
 * spelling the month out removes the guess. Use formatDateTime where the time
 * of day matters (chats, comments, provenance events).
 *
 * Accepts the string timestamps the schema stores (mode: "string") as well as
 * Date/number, matching date-fns' own input.
 */
type DateInput = Date | string | number

export const formatDate = (value: DateInput) => format(value, "MMM d, yyyy")

export const formatDateTime = (value: DateInput) =>
  format(value, "MMM d, yyyy 'at' h:mm a")
