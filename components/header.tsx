import Link from "next/link"
import Image from "next/image"
import { SITE_NAME } from "@/lib/site"
import { ThemeToggle } from "./theme-provider"
import { getCurrentUser } from "@/lib/current-user"
import { getActiveCommunity, myCommunities } from "@/lib/community-queries"
import { CommunitySwitcher } from "@/components/communities/switcher"
import { communitiesIndexPath } from "@/lib/public-identifiers"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./ui/dropdown-menu"
import { Button, buttonVariants } from "./ui/button"
import { MenuIcon, UserCircleIcon } from "lucide-react"
import { LogoutButton } from "./logout"
import { HeaderSearch } from "./header-search"
import styles from "./header.module.css"

export const Header = async () => {
  const user = await getCurrentUser()
  const [active, memberships] = user
    ? await Promise.all([getActiveCommunity(), myCommunities(user.id)])
    : [null, []]

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
        {/* The field is the fast path for a known query. The explicit Search
            link below remains the discoverable route to the full interface,
            including its syntax examples and filters. */}
        <HeaderSearch />
        <div className={styles.spacer} />
        <nav className={styles.navLinks} aria-label="Primary">
          <Link href="/search" className={styles.navButton}>
            Search
          </Link>
          <Link href="/terms" className={styles.navButton}>
            Browse
          </Link>
          <Link href="/tags" className={styles.navButton}>
            Tags
          </Link>
          <Link href="/discussion" className={styles.navButton}>
            Discussion
          </Link>
          <Link href="/add" className={styles.navButton}>
            Contribute
          </Link>
          <Link href="/docs" className={styles.navButton}>
            Documentation
          </Link>
          <ThemeToggle />
          <AuthSection user={user} active={active} memberships={memberships} />
        </nav>
        <details className={styles.mobileMenu}>
          <summary aria-label="Open navigation menu">
            <MenuIcon aria-hidden />
          </summary>
          <div className={styles.mobileMenuPanel}>
            <nav aria-label="Mobile">
              <Link href="/search">Search</Link>
              <Link href="/terms">Browse</Link>
              <Link href="/tags">Tags</Link>
              <Link href="/discussion">Discussion</Link>
              <Link href="/add">Contribute</Link>
              <Link href="/docs">Documentation</Link>
            </nav>
            <div className={styles.mobileUtility}>
              <span>Appearance</span>
              <ThemeToggle alwaysVisible />
            </div>
            <div className={styles.mobileAccount}>
              <AuthSection user={user} active={active} memberships={memberships} />
            </div>
          </div>
        </details>
      </header>
    </div>
  )
}

const AuthSection = ({
  user,
  active,
  memberships
}: {
  user: Awaited<ReturnType<typeof getCurrentUser>>
  active: { id: number; title: string } | null
  memberships: { id: number; title: string }[]
}) => {
  if (user)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
          <UserCircleIcon className="size-4" />
          <span className="hidden sm:block">{user.name}</span>
          {active && (
            <span className={styles.navScope}>· {active.title}</span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {memberships.length > 0 && (
            <>
              <CommunitySwitcher active={active} memberships={memberships} />
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <Link href={communitiesIndexPath}>Communities</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.role === "admin" && (
            <>
              <DropdownMenuItem asChild>
                <Link href="/admin">Admin Page</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <Link href="/profile">Profile</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/profile#authored-terms">Definitions</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <LogoutButton />
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <Button asChild variant="outline">
      <Link href="/login">Login</Link>
    </Button>
  )
}
