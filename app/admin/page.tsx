import { trpc } from "@/trpc/server";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import prompts from "@/lib/prompts.json";

const StatCard = ({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href: string;
}) => (
  <Link href={href}>
    <Card className="!py-4 hover:bg-secondary/50 transition-colors">
      <CardContent className="space-y-1">
        <p className="text-3xl font-semibold">{value}</p>
        <CardTitle className="text-muted-foreground text-sm font-normal">
          {label}
        </CardTitle>
      </CardContent>
    </Card>
  </Link>
);

export default async function AdminOverviewPage() {
  const stats = await trpc.admin.stats();

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Terms" value={stats.terms} href="/admin/terms" />
        <StatCard label="Definitions" value={stats.definitions} href="/admin/terms" />
        <StatCard label="Users" value={stats.users} href="/admin/users" />
        <StatCard label="Votes" value={stats.votes} href="/admin/terms" />
      </section>
      <section className="grid sm:grid-cols-2 gap-3">
        <Link href="/admin/prompts">
          <Card className="!py-4 h-full hover:bg-secondary/50 transition-colors">
            <CardContent className="space-y-1">
              <CardTitle>Prompts</CardTitle>
              <p className="text-sm text-muted-foreground">
                {Object.keys(prompts).length} system prompts in the registry
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/integrations">
          <Card className="!py-4 h-full hover:bg-secondary/50 transition-colors">
            <CardContent className="space-y-1">
              <CardTitle>Integrations</CardTitle>
              <p className="text-sm text-muted-foreground">
                Ollama and connected external APIs
              </p>
            </CardContent>
          </Card>
        </Link>
      </section>
    </div>
  );
}
