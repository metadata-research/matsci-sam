# MatSci SAM developer guide

This guide covers local setup, application changes, database migrations,
authentication, and release boundaries.

## Table of Contents

- [Quick Start](#quick-start)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Database Migrations](#database-migrations)
- [Adding/Editing Pages](#addingediting-pages)
- [Working with tRPC APIs](#working-with-trpc-apis)
- [UI Components](#ui-components)
- [Authentication](#authentication)
- [AI System Prompts](#ai-system-prompts)
- [Common Tasks](#common-tasks)
- [Deployment](#deployment)

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
pnpm db:migrate

# Start development server (with Turbopack)
pnpm dev
```

Visit `http://localhost:3000` to see the app running.

---

## Technology Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript
- **Backend**: tRPC for type-safe APIs
- **Database**: PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **Auth**: Google OAuth with iron-session
- **AI**: Ollama for LLM-powered features

---

## Project Structure

```
├── app/                    # Next.js App Router (pages & layouts)
│   ├── api/               # API routes
│   ├── terms/            # Term-related pages
│   ├── admin/            # Admin pages
│   └── ...               # Other pages
├── trpc/                  # tRPC API layer
│   ├── routers/          # API endpoints by feature
│   └── init.ts           # tRPC setup & context
├── drizzle/              # Database
│   ├── schema.ts         # Database schema
│   └── migrations/       # SQL migrations
├── components/           # React components
│   └── ui/              # shadcn/ui components
└── lib/                  # Utilities & helpers
```

---

## Database Migrations

### Understanding the Schema

The database schema is defined in `drizzle/schema.ts`. Its main records
include:

- `users` for human and named model identities, profile consent, roles, and
  reputation weight
- `oauthAccounts` and `emailAuthTokens` for external and verified-email
  authentication
- `terms` for vocabulary concepts
- `definitions` for the stable definition identity and current revision head
- `definitionRevisions` for immutable content versions and provenance
- `votes` and `comments`, each scoped to a definition revision
- `tags`, coauthors, refinement records, and discussion suggestions

### Creating a Migration

**Step 1: Modify the Schema**

Edit `drizzle/schema.ts`. For example, to add a field to the terms table:

```typescript
export const termsTable = pgTable("terms", {
  id: serial("id").primaryKey(),
  term: text("term").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Add your new field here:
  description: text("description"),
})
```

**Step 2: Generate Migration**

```bash
pnpm db:generate
```

This creates a new SQL file in `drizzle/migrations/` with the schema changes.

**Step 3: Apply Migration**

```bash
pnpm db:migrate
```

This runs all pending migrations against your database.

### Quick Database Commands

```bash
pnpm db:studio     # Open Drizzle Studio (visual database editor)
pnpm db:push       # Push schema changes without migrations (dev only)
pnpm db:drop       # Drop all tables (careful!)
```

### Example: Adding a New Table

```typescript
// In drizzle/schema.ts

export const myNewTable = pgTable("my_new_table", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export type MyNewTable = typeof myNewTable.$inferSelect
export type InsertMyNewTable = typeof myNewTable.$inferInsert
```

Then generate and run the migration:

```bash
pnpm db:generate
pnpm db:migrate
```

---

## Adding/Editing Pages

### Creating a New Page

Next.js uses file-based routing in the `app/` directory.

**Example: Create `/my-page`**

1. Create `app/my-page/page.tsx`:

```tsx
export default function MyPage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold">My New Page</h1>
      <p>This is my new page!</p>
    </div>
  )
}
```

2. Add metadata (optional):

```tsx
export const metadata = {
  title: "My Page - MatSci SAM",
  description: "Description of my page",
}
```

### Creating a Dynamic Route

**Example: Create `/my-page/[id]`**

Create `app/my-page/[id]/page.tsx`:

```tsx
export default async function MyDynamicPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="container mx-auto p-4">
      <h1>Item {id}</h1>
    </div>
  )
}
```

### Server vs Client Components

By default, all components in `app/` are **Server Components** (run on server).

To use client-side features (hooks, interactivity), add `"use client"`:

```tsx
"use client"

import { useState } from "react"

export default function MyClientComponent() {
  const [count, setCount] = useState(0)

  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  )
}
```

### Editing Existing Pages

Look in the `app/` directory. For example:

- Homepage: `app/page.tsx`
- Terms list: `app/terms/page.tsx`
- Term detail: `app/terms/[termId]/page.tsx`
- Admin dashboard: `app/admin/page.tsx`

---

## Working with tRPC APIs

### Understanding tRPC

tRPC provides end-to-end type-safe APIs. Define procedures on the server, call them from the client with full TypeScript support.

### Creating a New API Endpoint

**Step 1: Define the Router**

Create or edit a router in `trpc/routers/`. For example, `trpc/routers/my-feature.ts`:

```typescript
import { z } from "zod"
import { authenticatedProcedure, baseProcedure } from "../procedures"
import { router } from "../init"
import { db } from "@yamz/db"

export const myFeatureRouter = router({
  // Public endpoint
  getAll: baseProcedure.query(async () => {
    return await db.select().from(myNewTable)
  }),

  // Authenticated endpoint
  create: authenticatedProcedure
    .input(z.object({
      name: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const { userId } = ctx

      return await db.insert(myNewTable).values({
        name: input.name,
        userId,
      })
    }),
})
```

**Step 2: Add to Main Router**

In `trpc/routers/_app.ts`:

```typescript
import { myFeatureRouter } from "./my-feature"

export const appRouter = router({
  // ... existing routers
  myFeature: myFeatureRouter,
})
```

**Step 3: Use in Client Components**

```tsx
"use client"

import { trpc } from "@/trpc/client"

export function MyComponent() {
  const { data, isLoading } = trpc.myFeature.getAll.useQuery()
  const createMutation = trpc.myFeature.create.useMutation()

  const handleCreate = () => {
    createMutation.mutate({ name: "New item" })
  }

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      {data?.map(item => <div key={item.id}>{item.name}</div>)}
      <button onClick={handleCreate}>Create</button>
    </div>
  )
}
```

**Step 4: Use in Server Components**

```tsx
import { trpcServer } from "@/trpc/server"

export default async function MyServerComponent() {
  const data = await trpcServer.myFeature.getAll()

  return (
    <div>
      {data.map(item => <div key={item.id}>{item.name}</div>)}
    </div>
  )
}
```

### Available Procedures

- `baseProcedure` - Public endpoints
- `authenticatedProcedure` - Requires logged-in user (has `userId` in context)

---

## UI Components

### Using shadcn/ui Components

The project uses shadcn/ui components in `components/ui/`. To use them:

```tsx
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function MyComponent() {
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>My Dialog</DialogTitle>
        </DialogHeader>
        <Input placeholder="Enter text..." />
        <Button>Submit</Button>
      </DialogContent>
    </Dialog>
  )
}
```

### Available UI Components

Located in `components/ui/`:

- `button`, `input`, `textarea`, `label`
- `dialog`, `popover`, `dropdown-menu`
- `table`, `tabs`, `card`, `badge`
- `form` (with react-hook-form integration)
- `skeleton` (loading states)
- `sonner` (toast notifications)

### Adding a New shadcn/ui Component

```bash
npx shadcn@latest add [component-name]
```

For example:
```bash
npx shadcn@latest add alert-dialog
```

### Styling with Tailwind

Use Tailwind classes directly:

```tsx
<div className="flex items-center gap-4 p-6 bg-background text-foreground">
  <h1 className="text-2xl font-bold">Title</h1>
</div>
```

The theme supports dark mode automatically via CSS variables.

---

## Authentication

### Getting Current User

**In Server Components:**

```tsx
import { GetUser } from "@/lib/crud"
import { getSession } from "@/lib/session"

export default async function MyPage() {
  const session = await getSession()
  if (!session.id) {
    return <div>Please log in</div>
  }

  const user = await GetUser(session.id)
  if (!user) return <div>Account unavailable</div>

  return <div>Welcome, {user.name}!</div>
}
```

**In Client Components (via tRPC):**

```tsx
"use client"

import { trpc } from "@/trpc/client"

export function MyComponent() {
  const { data: user } = trpc.me.useQuery()

  if (!user) return <div>Not logged in</div>

  return <div>Welcome, {user.name}!</div>
}
```

**In tRPC Procedures:**

Authentication is handled automatically in `authenticatedProcedure`:

```typescript
create: authenticatedProcedure
  .input(z.object({ name: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const { userId } = ctx // User ID is available here
    // ...
  })
```

### Checking Admin Status

```tsx
const { data: user } = trpc.me.useQuery()

if (user?.role === "admin") {
  // Admin-only UI
}
```

---

## AI System Prompts

The AI definition feature sends a **system prompt** to Ollama with every request.
All prompts live in one file:

```
lib/prompts.json
```

### File format

Each entry is a named prompt with a human-readable description:

```json
{
  "materials-reference": {
    "description": "Steers the model toward materials-science-literature style and requires an original example.",
    "prompt": "You are a materials science reference. When given a term, ..."
  }
}
```

### Which prompt does the app use?

Selection happens at startup in `lib/apis/ollama.ts`, controlled by two
environment variables in `.env`:

- `SYSTEM_PROMPT_KEY` — the name of an entry in `lib/prompts.json`
  (e.g. `SYSTEM_PROMPT_KEY=materials-reference`). This is the normal way.
- `SYSTEM_PROMPT` — raw prompt text. Optional; if set, it **takes precedence**
  over `SYSTEM_PROMPT_KEY`. Mainly for quick experiments and older deployments.

If neither is set, or the key doesn't exist in the file, the app throws at
startup with a list of available prompt names.

### Changing or adding a prompt

1. Edit `lib/prompts.json` — either revise an existing entry's `prompt` text or
   add a new entry with a unique key, a `description`, and a `prompt`.
   Prefer adding a new entry over rewriting an old one, so the previous wording
   stays available for comparison.
2. Test it against the live model **without touching the database**:

   ```bash
   pnpm exec tsx scripts/test-prompt.ts "austenite"
   pnpm exec tsx scripts/test-prompt.ts "creep" "The turbine blade failed by creep."
   ```

   The script runs *every* prompt in the file against the same term and prints
   each definition/example side by side, with timing.
3. Point the app at your prompt: set `SYSTEM_PROMPT_KEY=<your-key>` in `.env`.
4. **Restart the dev server** (`pnpm dev`). The prompt is resolved once at
   startup, so edits to the JSON or `.env` are not picked up by a running server.

### Deployed environments

The same selection rules apply to a deployed environment. Commit changes to
`lib/prompts.json`, update `SYSTEM_PROMPT_KEY` in the protected environment,
and rebuild through the environment runbook. Do not edit a deployed release
in place.

### Generation provenance

Every AI response row in the `chats` table is stamped with the exact
conditions that produced it: `promptKey`, `promptHash`, `promptText`, and
`model`. This makes prompt experiments reportable after the fact — you can
attribute any generated definition to the prompt version and model that wrote
it (e.g. `SELECT "promptKey", "promptHash", count(*) FROM chats GROUP BY 1, 2`).
Don't remove or bypass these fields when touching the AI pipeline.

---

## Common Tasks

### Adding a New Form

1. Create a Zod schema for validation:

```typescript
import { z } from "zod"

const myFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
})
```

2. Use with react-hook-form and shadcn/ui Form:

```tsx
"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function MyForm() {
  const form = useForm({
    resolver: zodResolver(myFormSchema),
    defaultValues: { title: "", description: "" },
  })

  const onSubmit = (data) => {
    console.log(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  )
}
```

### Adding Toast Notifications

```tsx
"use client"

import { toast } from "sonner"

export function MyComponent() {
  const handleClick = () => {
    toast.success("Action completed!")
    // or
    toast.error("Something went wrong")
    // or
    toast.info("Information message")
  }

  return <button onClick={handleClick}>Do Something</button>
}
```

### Using Search

The app has a global search feature. Check `app/search/page.tsx` and `components/autocomplete.tsx` for examples.

### Working with Tags

Tags are many-to-many with definitions. See `trpc/routers/tags.ts` for the API and `app/tags/` for page examples.

---

## Deployment

### Environment Variables

Ensure all required variables are set (see `.env.example`):

- `DATABASE_URL` - PostgreSQL connection
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` - Google
  OAuth web client
- `GOOGLE_AUTH_ACCESS_MODE` - `existing-or-allowlisted` or `open`
- `GOOGLE_AUTH_ALLOWED_EMAILS` - optional exact comma-separated accounts
  allowed to create users in the restricted mode
- `SESSION_PASSWORD` - Session encryption (32+ chars)
- `OLLAMA_HOST` - AI service URL
- `SYSTEM_PROMPT_KEY` - Name of an AI system prompt from `lib/prompts.json` — see [AI System Prompts](#ai-system-prompts)
- `SYSTEM_PROMPT` - Raw AI prompt text; optional, takes precedence over `SYSTEM_PROMPT_KEY`

### Production build

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Run migrations
pnpm db:migrate

# Build the app
pnpm build

# Start production server
pnpm start
```

These commands build one checkout. They do not provide database backup,
service coordination, release switching, health checks, or rollback.

### Server deployment

A merge to `dev` does not deploy Superego. Maintainers use the runbook for the
target environment.

Do not merge or push any commit to `main`. Its active legacy self-hosted
workflow can migrate and restart the public environment. Retire or disable it
through a separate production change first, then verify the new boundary
before using `main`.

Before deployment, decide which database contains the authoritative data. A
disposable development target may be reset from a verified source snapshot. A
server with unique user data requires a write pause, a verified database
backup, forward migration, and database-aware rollback.

---

## Tips & Best Practices

1. **Type Safety**: Always define Zod schemas for form inputs and API endpoints
2. **Database Queries**: Use Drizzle ORM, avoid raw SQL when possible
3. **Server Components**: Prefer Server Components for data fetching, use Client Components only when needed
4. **tRPC**: Keep routers organized by feature in `trpc/routers/`
5. **UI Consistency**: Use shadcn/ui components for consistent styling
6. **Migrations**: Always generate migrations for schema changes, never modify the database directly
7. **Code Formatting**: Run `pnpm lint` before committing

---

## Getting Help

- Check existing code in similar features for patterns
- Review `README.md` for additional documentation
- Explore `drizzle/schema.ts` to understand the data model
- Use `pnpm db:studio` to visually inspect the database
- Check the Next.js, Drizzle, and tRPC documentation for framework-specific questions

Happy coding!
