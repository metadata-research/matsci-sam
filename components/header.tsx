import Link from "next/link"
import Image from "next/image"
import { SITE_NAME } from "@/lib/site"
import { ThemeToggle } from "./theme-provider"
import { getSession } from "@/lib/session"
import { db, usersTable } from "@yamz/db"
import { eq } from "drizzle-orm"
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
  const user = await getHeaderUser()

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
        {/* The search field replaces the old "Search" nav link: it flexes into
            the space the spacer used to hold, and going to /search is what
            submitting it does. */}
        <HeaderSearch />
        <div className={styles.spacer} />
        <nav className={styles.navLinks} aria-label="Primary">
          <Link href="/terms" className={styles.navButton}>
            Browse
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
          <AuthSection user={user} />
        </nav>
        <details className={styles.mobileMenu}>
          <summary aria-label="Open navigation menu">
            <MenuIcon aria-hidden />
          </summary>
          <div className={styles.mobileMenuPanel}>
            <nav aria-label="Mobile">
              <Link href="/terms">Browse</Link>
              <Link href="/discussion">Discussion</Link>
              <Link href="/add">Contribute</Link>
              <Link href="/docs">Documentation</Link>
            </nav>
            <div className={styles.mobileUtility}>
              <span>Appearance</span>
              <ThemeToggle alwaysVisible />
            </div>
            <div className={styles.mobileAccount}>
              <AuthSection user={user} />
            </div>
          </div>
        </details>
      </header>
    </div>
  )
}

const AuthSection = ({
  user
}: {
  user: Awaited<ReturnType<typeof getHeaderUser>>
}) => {
  if (user)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
          <UserCircleIcon className="size-4" />
          <span className="hidden sm:block">{user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
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
      <Link href="/api/login">Login</Link>
    </Button>
  )
}

const getHeaderUser = async () => {
  const sesh = await getSession()

  if (!sesh.id) return null

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, sesh.id))

  return user ?? null
}
