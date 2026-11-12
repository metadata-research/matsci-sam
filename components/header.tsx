import Link from "next/link"
import Image from "next/image"
import { SITE_NAME } from "@/lib/site"
import { getCurrentUser } from "@/lib/current-user"
import { getActiveCommunity, myCommunities } from "@/lib/community-queries"
import { CommunityMenu } from "./communities/switcher"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu"
import { Button, buttonVariants } from "./ui/button"
import { UserCircleIcon } from "lucide-react"
import { LogoutButton } from "./logout"
import { HeaderSearch } from "./header-search"
import { HelpLink } from "./help-link"
import { HeaderNavLink } from "./header-navigation"
import { MobileNavigationMenu } from "./mobile-navigation-menu"
import { cn } from "@/lib/utils"
import styles from "./header.module.css"

export const Header = async () => {
  const user = await getCurrentUser()
  const [active, memberships] = user
    ? await Promise.all([getActiveCommunity(), myCommunities(user.id)])
    : [null, []]
  const links = [
    {
      href: "/terms",
      label: "Browse terms",
      activePaths: ["/terms", "/search", "/vocabulary", "/vocabularies"]
    },
    ...(!memberships.length
      ? [
          {
            href: "/communities",
            label: "Communities",
            activePaths: ["/communities", "/metadata/workspace"]
          }
        ]
      : []),
    ...(user ? [{ href: "/profile/drafts", label: "My work" }] : []),
    { href: "/about", label: "About" }
  ]

  return (
    <div className={styles.wrapper}>
      <header className={styles.navbar}>
        <div className={styles.brandContext}>
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
          <div
            className={styles.communityContext}
            role="region"
            aria-label="Community selection"
            title={active?.title ?? "All communities"}
          >
            {memberships.length ? (
              <CommunityMenu scope={active} memberships={memberships} />
            ) : (
              <span className={styles.contextValue}>All communities</span>
            )}
          </div>
        </div>
        <div className={styles.spacer} />
        <HeaderSearch
          key={user?.id ?? "anonymous"}
          viewerId={user?.id ?? null}
        />
        <nav className={styles.navLinks} aria-label="Primary">
          {links.map((link) => (
            <HeaderNavLink
              key={link.href}
              href={link.href}
              activePaths={link.activePaths}
              className={styles.navButton}
            >
              {link.label}
            </HeaderNavLink>
          ))}
          <HelpLink />
          <AccountMenu user={user} includeHelpLinks={false} />
        </nav>
        <MobileNavigationMenu className={styles.mobileMenu}>
          <div className={styles.mobileMenuPanel}>
            <nav aria-label="Mobile">
              {links.map((link) => (
                <HeaderNavLink
                  key={link.href}
                  href={link.href}
                  activePaths={link.activePaths}
                >
                  {link.label}
                </HeaderNavLink>
              ))}
            </nav>
            <div className={styles.mobileUtility}>
              <HelpLink />
            </div>
            <div className={styles.mobileUtility}>
              <span>Account</span>
              <AccountMenu user={user} showName includeHelpLinks={false} />
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
 * recorded without its step. What remains is identity, so a
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
          <AccountMenu user={user} />
        </div>
      </header>
    </div>
  )
}

const AccountMenu = ({
  user,
  showName = false,
  includeHelpLinks = true
}: {
  user: Awaited<ReturnType<typeof getCurrentUser>>
  showName?: boolean
  includeHelpLinks?: boolean
}) => {
  if (user)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={user.name ?? "Account"}
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
            {user.name ?? "Account"}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {user.role === "admin" && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/admin">Administration</Link>
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
              <Link href="/profile#authored-terms">
                Published contributions
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {includeHelpLinks && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/docs/guide">Help</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/about">About MatSci-SAM</Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <LogoutButton />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <Button asChild variant="outline">
      <Link href="/login">Sign in</Link>
    </Button>
  )
}
