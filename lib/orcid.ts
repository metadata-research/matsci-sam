const ORCID_ID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

export const normalizeOrcidId = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\/(?:sandbox\.)?orcid\.org\//i, "")
    .toUpperCase()

export const isValidOrcidId = (value: string) => {
  const normalized = normalizeOrcidId(value)
  if (!ORCID_ID_PATTERN.test(normalized)) return false

  const characters = normalized.replaceAll("-", "")
  let total = 0

  for (const character of characters.slice(0, 15))
    total = (total + Number(character)) * 2

  const checkValue = (12 - (total % 11)) % 11
  const expected = checkValue === 10 ? "X" : String(checkValue)
  return characters.at(-1) === expected
}
