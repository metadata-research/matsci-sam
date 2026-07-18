import Link from "next/link";
import { ThemeToggle } from "./theme-provider";
import { getSession } from "@/lib/session";
import { db, usersTable } from "@yamz/db";
import { eq } from "drizzle-orm";
import { OAuthURL } from "@/lib/apis/google";
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
import styles from "./header.module.css"

export const Header = () => {
  return (
    <header className={styles.navbar}>
      <img src="/favicon.ico" alt="MatSci YAMZ" className={styles.logo} />
      <Link href="/" className={styles.logoText}>
        MatSci YAMZ
      </Link>
      <div className={styles.spacer} />
      <div className={styles.navLinks}>
        <Link href="/search" className={styles.navButton}>Search</Link>
        <Link href="/terms" className={styles.navButton}>Browse</Link>
        <Link href="/add" className={styles.navButton}>Add</Link>
        <Link href="/tags" className={styles.navButton}>Tags</Link>
        <ThemeToggle />
        <Suspense fallback={null}>
          <AuthSection />
        </Suspense>
      </div>
    </header>
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
    <Link href={OAuthURL}>
      <Button variant="outline" className={styles.navButton}>Login</Button>
    </Link>
  );
};
