import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getDevAuthUsers,
  isDevAuthEnabled,
  type DevAuthUser
} from "@/lib/dev-auth"
import { getSession } from "@/lib/session"
import { notFound, redirect } from "next/navigation"

type Props = {
  searchParams: Promise<{ error?: string }>
}

export default async function DevLoginPage({ searchParams }: Props) {
  if (!isDevAuthEnabled()) notFound()

  const session = await getSession()
  if (session.id) redirect("/profile")

  let users: DevAuthUser[]
  try {
    users = getDevAuthUsers()
  } catch {
    users = []
  }

  const { error } = await searchParams
  const errorMessage = error === "invalid"
    ? "The selected user or shared password was not recognized."
    : error === "configuration" || users.length === 0
      ? "Development login has not been configured on this server."
      : null

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Development login</CardTitle>
          <CardDescription>
            Choose your identity and enter the shared development password.
            Your contributions will be attributed to the selected account.
          </CardDescription>
        </CardHeader>
        <form action="/api/auth/dev-login" method="post">
          <CardContent className="space-y-4">
            {errorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="username">User</Label>
              <select
                id="username"
                name="username"
                required
                disabled={users.length === 0}
                defaultValue=""
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] disabled:opacity-50"
              >
                <option value="" disabled>Select your name</option>
                {users.map((user) => (
                  <option value={user.username} key={user.username}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Shared password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={users.length === 0}
              />
            </div>
          </CardContent>
          <CardFooter className="pt-6">
            <Button type="submit" className="w-full" disabled={users.length === 0}>
              Log in
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
