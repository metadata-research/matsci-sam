import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Profile | ${SITE_NAME}` }
import { db, usersTable } from "@yamz/db";
import { getSession } from "@/lib/session";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { EditProfileForm } from "./form";

export default async function Profile() {
  // Get session and return to homepage if they aren't authenticated
  const sesh = await getSession();
  if (!sesh.id) redirect("/");

  // Get user from the database
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, sesh.id))
    .limit(1);

  if (!user) redirect("/");

  return (
    <main className="flex-1 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <h1 className="text-3xl font-bold leading-none">Profile Settings</h1>
          <p className="text-secondary-foreground mt-2">
            Manage your account information and preferences
          </p>
        </div>
        <EditProfileForm defaults={user} />
      </div>
    </main>
  );
}
