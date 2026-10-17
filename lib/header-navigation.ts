type SearchParameters = Pick<URLSearchParams, "get">

export type HeaderLinkDestination = {
  href: string
  exact?: boolean
  activePaths?: readonly string[]
}

export type HeaderMenuDestinations = {
  activePaths: readonly string[]
  activeHrefs?: readonly string[]
}

export const headerDestinationPath = (href: string) => href.split(/[?#]/)[0]

export const isWithinHeaderPath = (pathname: string, href: string) => {
  const path = headerDestinationPath(href)
  return pathname === path || (path !== "/" && pathname.startsWith(`${path}/`))
}

/** Setup tasks identify separate destinations; other query values are context. */
export function headerLinkState(
  pathname: string,
  { href, exact = false, activePaths }: HeaderLinkDestination,
  searchParams?: SearchParameters
) {
  const destination = new URL(href, "https://matsci.invalid")
  const taskMatches =
    destination.pathname !== "/setup" ||
    (searchParams !== undefined &&
      searchParams.get("task") === destination.searchParams.get("task"))
  const current = pathname === destination.pathname && taskMatches
  const active =
    taskMatches &&
    (activePaths
      ? activePaths.some((path) => isWithinHeaderPath(pathname, path))
      : exact
        ? current
        : isWithinHeaderPath(pathname, destination.pathname))

  return { active, current }
}

export function headerMenuIsActive(
  pathname: string,
  { activePaths, activeHrefs = [] }: HeaderMenuDestinations,
  searchParams?: SearchParameters
) {
  return (
    activePaths.some((path) => isWithinHeaderPath(pathname, path)) ||
    activeHrefs.some(
      (href) => headerLinkState(pathname, { href }, searchParams).active
    )
  )
}
