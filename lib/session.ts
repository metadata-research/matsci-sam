import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { YAMZSession } from "./types";

export const getSession = async () => {
  const allowInsecureDevCookie =
    process.env.DEV_AUTH_ENABLED === "true" &&
    process.env.SESSION_COOKIE_SECURE === "false"

  return await getIronSession<YAMZSession>(await cookies(), {
    password: process.env.SESSION_PASSWORD!,
    cookieName: "matsci-sam-session",
    cookieOptions: {
      secure: !allowInsecureDevCookie,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    },
  })
}
