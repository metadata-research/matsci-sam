import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { YAMZSession } from "./types";

export const getSession = async () =>
  await getIronSession<YAMZSession>(await cookies(), {
    password: process.env.SESSION_PASSWORD!,
    cookieName: "matsci-sam-session",
  });
