// This grammar excludes activity/rank application views and accepts only the
// existing public resource coordinates. Database lookup disambiguates a
// one-segment community scheme from a default-vocabulary term.
const slug = "[a-z0-9][a-z0-9_-]*"
const resource = new RegExp(
  `^/vocabulary(?:/${slug}){0,2}(?:/definitions/[1-9]\\d*(?:/revisions/[1-9]\\d*)?)?$`
)
export function vocabularyDocument(path: string) {
  const explicit = path.match(
    /\/(skos\.(ttl|jsonld)|provenance\.(ttl|jsonld))$/
  )
  const base = explicit
    ? path.slice(0, -explicit[0].length)
    : path.replace(/\/provenance$/, "")
  if (!resource.test(base)) return null
  const provenance = explicit
    ? explicit[1].startsWith("provenance")
    : path.endsWith("/provenance")
  return {
    resource: base,
    provenance,
    format: explicit ? ((explicit[2] ?? explicit[3]) as "ttl" | "jsonld") : null
  }
}

const offered = [
  ["html", "text/html"],
  ["ttl", "text/turtle"],
  ["jsonld", "application/ld+json"]
] as const
export function preferredRepresentation(
  accept: string | null
): "html" | "ttl" | "jsonld" | null {
  if (!accept?.trim()) return "html"
  const ranges = accept
    .toLowerCase()
    .split(",")
    .map((part) => {
      const [media, ...params] = part.trim().split(";")
      const raw =
        params
          .map((p) => p.trim())
          .find((p) => p.startsWith("q="))
          ?.slice(2) ?? "1"
      const q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw)
        ? Number(raw)
        : 0
      return { media: media.trim(), q }
    })
  let best:
    | { name: "html" | "ttl" | "jsonld"; q: number; specificity: number }
    | undefined
  for (const [name, media] of offered) {
    let selected: { q: number; specificity: number } | undefined
    for (const range of ranges) {
      const specificity =
        range.media === media
          ? 2
          : range.media === media.split("/")[0] + "/*"
            ? 1
            : range.media === "*/*"
              ? 0
              : -1
      if (
        specificity >= 0 &&
        (!selected ||
          specificity > selected.specificity ||
          (specificity === selected.specificity && range.q > selected.q))
      )
        selected = { q: range.q, specificity }
    }
    if (
      selected &&
      selected.q > 0 &&
      (!best ||
        selected.q > best.q ||
        (selected.q === best.q && selected.specificity > best.specificity))
    )
      best = { name, ...selected }
  }
  return best?.name ?? null
}
