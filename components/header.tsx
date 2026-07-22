import Link from "next/link";
import { SITE_NAME } from "@/lib/site"
import { ThemeToggle } from "./theme-provider";
import { getSession } from "@/lib/session";
import { db, usersTable } from "@yamz/db";
import { eq } from "drizzle-orm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Suspense } from "react";
import { Button } from "./ui/button";
import { UserCircleIcon } from "lucide-react";
import { LogoutButton } from "./logout";
import { HeaderSearch } from "./header-search";
import styles from "./header.module.css"

export const Header = () => {
  return (
    <div className={styles.wrapper}>
      <header className={styles.navbar}>
        <img src="/logo.svg" alt={SITE_NAME} className={styles.logo} />
        <Link href="/" className={styles.logoText}>
          {SITE_NAME}
        </Link>
        {/* The search field replaces the old "Search" nav link: it flexes into
            the space the spacer used to hold, and going to /search is what
            submitting it does. */}
        <HeaderSearch />
        <div className={styles.spacer} />
        <div className={styles.navLinks}>
          <Link href="/terms" className={styles.navButton}>Browse</Link>
          <Link href="/discussion" className={styles.navButton}>Discussion</Link>
          <Link href="/add" className={styles.navButton}>Add</Link>
          <Link href="/docs" className={styles.navButton}>Docs</Link>
          <ThemeToggle />
          <Suspense fallback={null}>
            <AuthSection />
          </Suspense>
        </div>
      </header>
    </div>
  );
};

const AuthSection = async () => {
  const sesh = await getSession();

  if (sesh.id) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, sesh.id));

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <UserCircleIcon className="size-4" />
            <a className="hidden sm:block">
              {user.name}
            </a>
          </Button>
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
          <Link href="/profile">
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </Link>
          <Link href="/profile/terms">
            <DropdownMenuItem>Definitions</DropdownMenuItem>
          </Link>
          <DropdownMenuSeparator />
          <LogoutButton />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Link href="/api/login">
      <Button variant="outline">Login</Button>
    </Link>
  );
};
