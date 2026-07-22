import { db, usersTable } from "@yamz/db";
import { oauth } from "@/lib/apis/google";
import { getSession } from "@/lib/session";
import { google } from "googleapis";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";

export const GET = async (req: NextRequest) => {
  // Get session
  const session = await getSession();

  // Get the OAuth code from url params
  const code = req.nextUrl.searchParams.get("code");
  if (!code) redirect("/");

  // Get google token from oauth code
  const token = await oauth.getToken(code);
  oauth.setCredentials(token.tokens);

  // Get user info with oauth credentials
  const userInfo = await google
    .oauth2({ version: "v2", auth: oauth })
    .userinfo.get();
  const {
    id: userId,
    name,
    email,
    given_name: givenName,
    family_name: familyName,
  } = userInfo.data;
  if (!userId || !email)
    throw new Error("Didn't get sufficient user info from Google!");

  const normalizedEmail = email.trim().toLowerCase();
  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.googleId, userId),
  });

  // A development identity is created with the same email but without a
  // Google ID. Attach OAuth to that row so its existing authorship survives
  // the transition to production authentication.
  if (!user) {
    user = await db.query.usersTable.findFirst({
      where: sql`lower(${usersTable.email}) = ${normalizedEmail}`,
    });
  }

  if (user?.googleId && user.googleId !== userId)
    throw new Error("That email is already associated with another Google account");

  if (user) {
    const [updated] = await db
      .update(usersTable)
      .set({
        googleId: userId,
        name: name || user.name,
        email: normalizedEmail,
        firstName: user.firstName || givenName || null,
        lastName: user.lastName || familyName || null,
      })
      .where(eq(usersTable.id, user.id))
      .returning();
    user = updated;
  } else {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        googleId: userId,
        name: name || "",
        email: normalizedEmail,
        firstName: givenName || null,
        lastName: familyName || null,
      })
      .returning();
    user = inserted;
  }

  // Save id in session for future requests
  session.id = user!.id;
  await session.save();

  // Redirect to profile page
  redirect("/profile");
};
