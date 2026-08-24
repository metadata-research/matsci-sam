import Link from "next/link"
import Image from "next/image"
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
import { MobileNavigationMenu } from "./mobile-navigation-menu"
import { cn } from "@/lib/utils"
import styles from "./header.module.css"

/*
 * The primary navigation is two groups and a link: the vocabulary (what is
 * published) and taking part (what a person does), with the documentation
 * on its own. The community a person is working in has its own control
 * beside the account, with room for its name, because that standing choice
 * scopes what the pages show and was easy to miss inside the account menu.
 */
const VOCABULARY: Entry[] = [
  { href: "/terms", label: "Browse" },
  { href: tagsIndexPath, label: "Tags" },
  { href: collectionsIndexPath, label: "Collections" },
  { href: modelsIndexPath, label: "Models" },
  { href: "/search", label: "Search" }
]

const TAKE_PART: Entry[] = [
  { href: "/add", label: "Contribute" },
  { href: "/discussion", label: "Discussion" },
  { href: studiesIndexPath, label: "Studies" },
  { href: communitiesIndexPath, label: "Communities" }
]

type Entry = { href: string; label: string }
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
          <Link href="/docs" className={styles.navButton}>
            Documentation
          </Link>
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
                <Link key={entry.href} href={entry.href}>
                  {entry.label}
                </Link>
              ))}
              <span className={styles.mobileLabel}>Participate</span>
              {TAKE_PART.map((entry) => (
                <Link key={entry.href} href={entry.href}>
                  {entry.label}
                </Link>
              ))}
              <Link href="/docs">Documentation</Link>
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

// A group of the primary navigation: a trigger in the bar, its entries in a
// menu. The links are plain anchors, so a server component can render it.
const NavMenu = ({ label, entries }: { label: string; entries: Entry[] }) => (
  <DropdownMenu>
    <DropdownMenuTrigger className={styles.navButton}>
      {label}
      <ChevronDownIcon className={styles.navChevron} aria-hidden />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuGroup>
        {entries.map((entry) => (
          <DropdownMenuItem key={entry.href} asChild>
            <Link href={entry.href}>{entry.label}</Link>
          </DropdownMenuItem>
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
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
          <UserCircleIcon aria-hidden />
          <span className={showName ? undefined : "hidden sm:block"}>
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
