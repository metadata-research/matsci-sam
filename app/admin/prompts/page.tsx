import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import prompts from "@/lib/prompts.json";

export default function AdminPromptsPage() {
  const rawOverride = Boolean(process.env.SYSTEM_PROMPT);
  const activeKey = process.env.SYSTEM_PROMPT_KEY;

  return (
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold">Prompts</h2>
      <p className="text-sm text-muted-foreground">
        System prompts available to the AI definition pipeline. The registry
        lives in <code>lib/prompts.json</code>; the active prompt is selected
        with the <code>SYSTEM_PROMPT_KEY</code> environment variable.
      </p>
      {rawOverride && (
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle>Raw override active</CardTitle>
            <CardDescription>
              The <code>SYSTEM_PROMPT</code> environment variable is set and
              takes precedence over the registry: {process.env.SYSTEM_PROMPT}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {Object.entries(prompts).map(([key, { description, prompt }]) => (
        <Card key={key} className="!gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-base">
              {key}
              {!rawOverride && key === activeKey && <Badge>Active</Badge>}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm italic">{prompt}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
