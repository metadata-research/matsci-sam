import Link from "next/link"
import Image from "next/image"
import { Fragment } from "react"
import { SITE_NAME } from "@/lib/site"
import { ThemeMenu, ThemeToggle } from "./theme-provider"
import { getCurrentUser } from "@/lib/current-user"
import { getActiveCommunity, myCommunities } from "@/lib/community-queries"
import { CommunitySwitcher } from "@/components/communities/switcher"
import {
  collectionsIndexPath,
  communitiesIndexPath,
  communityPath,
  modelsIndexPath,
  studiesIndexPath,
  tagsIndexPath
} from "@/lib/public-identifiers"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu"
import { Button, buttonVariants } from "./ui/button"
import { ChevronDownIcon, UserCircleIcon, UsersIcon } from "lucide-react"
import { LogoutButton } from "./logout"
import { HeaderSearch } from "./header-search"
import { HeaderNavLink, HeaderNavMenuTrigger } from "./header-navigation"
import { MobileNavigationMenu } from "./mobile-navigation-menu"
import { cn } from "@/lib/utils"
import styles from "./header.module.css"

/*
 * The primary navigation groups the vocabulary (what is published) and
 * taking part (what a person does), with help and project information
 * alongside them. The community a person is working in has its own control
 * beside the account, with room for its name, because that standing choice
 * scopes what the pages show and was easy to miss inside the account menu.
 */
const VOCABULARY: Entry[] = [
  { href: "/terms", label: "Browse" },
  { href: "/search", label: "Search" },
  { href: collectionsIndexPath, label: "Collections" },
  { href: modelsIndexPath, label: "Models" },
  { href: "/metadata/fields", label: "Metadata fields" },
  { href: tagsIndexPath, label: "Tags", secondary: true }
]

const TAKE_PART: Entry[] = [
  { href: "/docs", label: "Quick Start" },
  { href: "/add", label: "Contribute" },
  { href: "/discussion", label: "Discussion" },
  { href: communitiesIndexPath, label: "Communities" },
  { href: studiesIndexPath, label: "Studies" }
]

type Entry = { href: string; label: string; secondary?: boolean }
type Community = { id: number; slug: string; title: string }

export const Header = async () => {
  const user = await getCurrentUser()
  const [active, memberships] = user
    ? await Promise.all([getActiveCommunity(), myCommunities(user.id)])
    : [null, []]
  // The active community as the switcher lists it, with its slug for the
  // links; null when the person chose everything or belongs to nothing.
  const scope = active
    ? (memberships.find((m) => m.id === active.id) ?? null)
    : null

  return (
    <div className={styles.wrapper}>
      <header className={styles.navbar}>
        <Link
          href="/"
          className={styles.logoHome}
          aria-label={`${SITE_NAME} home`}
        >
          <Image
            src="/logo.svg"
            alt=""
            width={30}
            height={30}
            className={styles.logo}
            preload
          />
          <span className={styles.logoText}>{SITE_NAME}</span>
        </Link>
        {/* The field is the fast path for a known query. The Search entry of
            the Vocabulary menu remains the discoverable route to the full
            interface, including its syntax examples and filters. */}
        <HeaderSearch />
        <div className={styles.spacer} />
        <nav className={styles.navLinks} aria-label="Primary">
          <NavMenu label="Vocabulary" entries={VOCABULARY} />
          <NavMenu label="Participate" entries={TAKE_PART} />
          <HeaderNavLink href="/docs" className={styles.navButton}>
            Help &amp; Guides
          </HeaderNavLink>
          <HeaderNavLink href="/about" className={styles.navButton}>
            About
          </HeaderNavLink>
          {memberships.length > 0 && (
            <CommunityMenu scope={scope} memberships={memberships} />
          )}
          {!user && <ThemeToggle />}
          <AccountMenu user={user} />
        </nav>
        <MobileNavigationMenu className={styles.mobileMenu}>
          <div className={styles.mobileMenuPanel}>
            <nav aria-label="Mobile">
              <span className={styles.mobileLabel}>Vocabulary</span>
              {VOCABULARY.map((entry) => (
                <HeaderNavLink
                  key={entry.href}
                  href={entry.href}
                  className={
                    entry.secondary ? styles.secondaryNavLink : undefined
                  }
                >
                  {entry.label}
                </HeaderNavLink>
              ))}
              <span className={styles.mobileLabel}>Participate</span>
              {TAKE_PART.map((entry) => (
                <HeaderNavLink
                  key={entry.href}
                  href={entry.href}
                  exact={entry.href === "/docs"}
                >
                  {entry.label}
                </HeaderNavLink>
              ))}
              <HeaderNavLink href="/docs">Help &amp; Guides</HeaderNavLink>
              <HeaderNavLink href="/about">About</HeaderNavLink>
            </nav>
            {memberships.length > 0 && (
              <div className={styles.mobileUtility}>
                <span>Working in</span>
                <CommunityMenu scope={scope} memberships={memberships} />
              </div>
            )}
            {!user && (
              <div className={styles.mobileUtility}>
                <span>Appearance</span>
                <ThemeToggle alwaysVisible />
              </div>
            )}
            <div className={styles.mobileUtility}>
              <span>Account</span>
              <AccountMenu user={user} showName />
            </div>
          </div>
        </MobileNavigationMenu>
      </header>
    </div>
  )
}

/*
 * The strip the walkthrough run page shows in place of the navigation. A
 * participant working through a study stays in the walkthrough: the site
 * navigation is the one path out mid-step, and a vote cast out there is
 * recorded without its step. What remains is identity and appearance, so a
 * participant can confirm the account their acts are recorded under. The
 * wordmark is not a link here for the same reason the menus are gone.
 */
export const HeaderStrip = async () => {
  const user = await getCurrentUser()

  return (
    <div className={styles.wrapper}>
      <header className={styles.navbar}>
        <span className={styles.logoHome}>
          <Image
            src="/logo.svg"
            alt=""
            width={30}
            height={30}
            className={styles.logo}
            preload
          />
          <span className={styles.logoText}>{SITE_NAME}</span>
        </span>
        <div className={styles.spacer} />
        <div className={styles.stripLinks}>
          {!user && <ThemeToggle alwaysVisible />}
          <AccountMenu user={user} />
        </div>
      </header>
    </div>
  )
}

// Only the links and trigger read the route; the menu structure stays here
// alongside the server-rendered header and account controls.
const NavMenu = ({ label, entries }: { label: string; entries: Entry[] }) => (
  <DropdownMenu>
    <HeaderNavMenuTrigger
      className={styles.navButton}
      activePaths={entries
        .filter((entry) => entry.href !== "/docs")
        .map((entry) => entry.href)}
    >
      {label}
      <ChevronDownIcon className={styles.navChevron} aria-hidden />
    </HeaderNavMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuGroup>
        {entries.map((entry) => (
          <Fragment key={entry.href}>
            {entry.secondary && <DropdownMenuSeparator />}
            <DropdownMenuItem asChild>
              <HeaderNavLink
                href={entry.href}
                className={styles.menuLink}
                exact={entry.href === "/docs"}
              >
                {entry.label}
              </HeaderNavLink>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)

/*
 * The community a person is working in. The trigger names it, or says
 * "Everything" when no scope is chosen; the menu holds the switcher and the
 * way into the community's page and studies. Rendered only for a member of
 * at least one community, so a reader with none sees no new chrome.
 */
const CommunityMenu = ({
  scope,
  memberships
}: {
  scope: Community | null
  memberships: Community[]
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      className={cn(buttonVariants({ variant: "outline" }), styles.scopePill)}
      aria-label={
        scope ? `Working in ${scope.title}` : "Working in every community"
      }
    >
      <UsersIcon aria-hidden />
      <span className={styles.scopeName}>
        {scope ? scope.title : "Everything"}
      </span>
      <ChevronDownIcon className={styles.navChevron} aria-hidden />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <CommunitySwitcher active={scope} memberships={memberships} />
      <DropdownMenuSeparator />
      {scope && (
        <>
          <DropdownMenuLabel>{scope.title}</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href={communityPath(scope.slug)}>Community page</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${communityPath(scope.slug)}#studies`}>
                Studies of {scope.title}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuGroup>
        <DropdownMenuItem asChild>
          <Link href={communitiesIndexPath}>All communities</Link>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)

const AccountMenu = ({
  user,
  showName = false
}: {
  user: Awaited<ReturnType<typeof getCurrentUser>>
  showName?: boolean
}) => {
  if (user)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "outline" }),
            styles.accountButton
          )}
        >
          <UserCircleIcon aria-hidden />
          <span
            className={cn("min-w-0 truncate", !showName && "hidden sm:block")}
            title={user.name ?? undefined}
          >
            {user.name}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {user.role === "admin" && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/admin">Admin Page</Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile#authored-terms">Definitions</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <ThemeMenu />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <LogoutButton />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <Button asChild variant="outline">
      <Link href="/login">Login</Link>
    </Button>
  )
}
