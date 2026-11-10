/** PostgreSQL emits variable-width fractions and offsets, unlike ISO Date strings. */
function timestampParts(
  value: string
): { milliseconds: number; fraction: number } | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      value
    )
  if (!match) return null
  const fraction = (match[3] ?? "").padEnd(9, "0")
  let offset = match[4]
  if (/^[+-]\d{2}$/.test(offset)) offset += ":00"
  else if (/^[+-]\d{4}$/.test(offset))
    offset = `${offset.slice(0, 3)}:${offset.slice(3)}`
  const milliseconds = Date.parse(
    `${match[1]}T${match[2]}.${fraction.slice(0, 3)}${offset}`
  )
  return Number.isFinite(milliseconds)
    ? { milliseconds, fraction: Number(fraction.slice(3)) }
    : null
}

/** Match SQL timestamp precision and numeric ID order before merging its page prefix. */
export function compareCommunityContributions(
  a: { createdAt: string; target: string },
  b: { createdAt: string; target: string }
) {
  const left = timestampParts(a.createdAt)
  const right = timestampParts(b.createdAt)
  const time =
    left && right
      ? right.milliseconds - left.milliseconds || right.fraction - left.fraction
      : left
        ? -1
        : right
          ? 1
          : b.createdAt.localeCompare(a.createdAt)
  if (time) return time
  if (a.target.startsWith("definition:") && b.target.startsWith("definition:"))
    return Number(b.target.slice(11)) - Number(a.target.slice(11))
  return b.target.localeCompare(a.target)
}
