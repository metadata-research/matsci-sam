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
import { quickStartActions, setupHref } from "./quick-start"
import { cn } from "@/lib/utils"
import styles from "./header.module.css"

/*
 * Vocabulary brings browsing and creation together. Participate holds the
 * communities, discussion, studies and contributing model identities.
 * The community a person is working in has its own control
 * beside the account, with room for its name, because that standing choice
 * scopes what the pages show and was easy to miss inside the account menu.
 */
const METADATA_CATALOG_PATHS = [
  "/metadata/fields",
  "/metadata/matcore",
  "/metadata/experimental",
  "/metadata/examples"
]

const VOCABULARY: Entry[] = [
  { href: "/terms", label: "Browse terms" },
  { href: "/search", label: "Search terms" },
  {
    href: "/vocabularies",
    label: "Vocabularies",
    activePaths: ["/vocabularies", "/vocabulary"]
  },
  { href: collectionsIndexPath, label: "Collections" },
  { href: tagsIndexPath, label: "Tags & facets" },
  {
    href: "/metadata/fields",
    label: "Metadata field catalog",
    activePaths: METADATA_CATALOG_PATHS
  }
]

type Entry = {
  href: string
  label: string
  secondary?: boolean
  activePaths?: string[]
}
type MenuGroup = { label?: string; entries: Entry[] }
type Menu = {
  label: string
  groups: MenuGroup[]
  activePaths: string[]
  activeHrefs?: string[]
  wide?: boolean
}
type Community = { id: number; slug: string; title: string }

export const Header = async () => {
  const user = await getCurrentUser()
  const [active, memberships] = user
    ? await Promise.all([getActiveCommunity(), myCommunities(user.id)])
    : [null, []]
  // The active community as the switcher lists it, with its slug for the
  // links. Null when the person chose everything or belongs to nothing.
  const scope = active
    ? (memberships.find((m) => m.id === active.id) ?? null)
    : null
  const createContext = {
    communityId: active?.id,
    vocabularySlug: active?.vocabularySlug
  }
  const actions = quickStartActions(createContext)
  const createEntries: Entry[] = [
    ...actions,
    {
      href: setupHref(createContext),
      label: "Guide me through setup",
      secondary: true
    }
  ]
  const menus: Menu[] = [
    {
      label: "Vocabulary",
      wide: true,
      activePaths: [
        "/terms",
        "/search",
        "/vocabularies",
        "/vocabulary",
        "/collections",
        "/tags",
        ...METADATA_CATALOG_PATHS,
        "/add"
      ],
      activeHrefs: createEntries.map((entry) => entry.href),
      groups: [
        { label: "Explore", entries: VOCABULARY },
        { label: "Create", entries: createEntries }
      ]
    },
    {
      label: "Participate",
      activePaths: [
        "/communities",
        "/metadata/workspace",
        "/discussion",
        "/studies",
        "/models"
      ],
      groups: [
        {
          entries: [
            {
              href: communitiesIndexPath,
              label: "Community workspaces",
              activePaths: ["/communities", "/metadata/workspace"]
            }
          ]
        },
        {
          entries: [
            { href: "/discussion", label: "Discussion" },
            { href: studiesIndexPath, label: "Surveys" }
          ]
        },
        { entries: [{ href: modelsIndexPath, label: "AI models" }] }
      ]
    }
  ]

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
          {menus.map((menu) => (
            <NavMenu key={menu.label} {...menu} />
          ))}
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
              {menus.map((menu) => (
                <MobileNavGroup key={menu.label} {...menu} />
              ))}
              <HeaderNavLink href="/docs">Help &amp; Guides</HeaderNavLink>
              <HeaderNavLink href="/about">About</HeaderNavLink>
            </nav>
            {memberships.length > 0 && (
              <div className={styles.mobileUtility}>
                <span>Default community</span>
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

// Only the links and trigger read the route. The menu structure stays here
// alongside the server-rendered header and account controls.
const NavMenu = ({ label, groups, activePaths, activeHrefs, wide }: Menu) => (
  <DropdownMenu>
    <HeaderNavMenuTrigger
      className={styles.navButton}
      activePaths={activePaths}
      activeHrefs={activeHrefs}
    >
      {label}
      <ChevronDownIcon className={styles.navChevron} aria-hidden />
    </HeaderNavMenuTrigger>
    <DropdownMenuContent
      align="start"
      className={cn(styles.primaryMenu, wide && styles.wideMenu)}
    >
      {groups.map((group, index) => (
        <Fragment key={group.label ?? index}>
          {!wide && index > 0 && <DropdownMenuSeparator />}
          <DropdownMenuGroup
            className={styles.menuGroup}
            aria-label={group.label}
          >
            {group.label && (
              <DropdownMenuLabel className={styles.menuGroupLabel}>
                {group.label}
              </DropdownMenuLabel>
            )}
            {group.entries.map((entry) => (
              <Fragment key={entry.href}>
                {entry.secondary && <DropdownMenuSeparator />}
                <DropdownMenuItem asChild>
                  <HeaderNavLink
                    href={entry.href}
                    activePaths={entry.activePaths}
                    className={styles.menuLink}
                  >
                    {entry.label}
                  </HeaderNavLink>
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuGroup>
        </Fragment>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)

const MobileNavGroup = ({ label, groups }: Menu) => (
  <details className={styles.mobileNavGroup}>
    <summary>
      {label}
      <ChevronDownIcon aria-hidden />
    </summary>
    <div className={styles.mobileNavContents}>
      {groups.map((group, index) => (
        <div key={group.label ?? index} className={styles.mobileLinkGroup}>
          {group.label && (
            <span className={styles.mobileLabel}>{group.label}</span>
          )}
          {group.entries.map((entry) => (
            <HeaderNavLink
              key={entry.href}
              href={entry.href}
              activePaths={entry.activePaths}
              className={entry.secondary ? styles.secondaryNavLink : undefined}
            >
              {entry.label}
            </HeaderNavLink>
          ))}
        </div>
      ))}
    </div>
  </details>
)

/*
 * The community a person is working in. The trigger names it, or says
 * "Everything" when no scope is chosen. The menu holds the switcher and the
 * one way into the selected community's work. Other sections live inside
 * that workspace; Participate holds the directory. Rendered only for a member of
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
        scope
          ? `Default community: ${scope.title}`
          : "Default community: Everything"
      }
    >
      <UsersIcon aria-hidden />
      <span className="hidden text-xs text-muted-foreground lg:inline">
        Default
      </span>
      <span className={styles.scopeName}>
        {scope ? scope.title : "Everything"}
      </span>
      <ChevronDownIcon className={styles.navChevron} aria-hidden />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <CommunitySwitcher active={scope} memberships={memberships} />
      {scope && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href={`${communityPath(scope.slug)}?view=work`}>
                Open workspace
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </>
      )}
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
              <Link href="/profile/drafts">My term drafts</Link>
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
