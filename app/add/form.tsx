"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { DefineTerm, DefineTermSchema } from "@/lib/schemas/terms";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import { useRouter } from "next/navigation";
import { AutoComplete } from "@/components/autocomplete";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";

export const DefineTermForm = ({
  interactive: interactiveDefault = false,
}: {
  // Initial mode; /add starts classic, /add/interactive starts interactive.
  // The toggle switches modes in place without losing typed input.
  interactive?: boolean;
}) => {
  const router = useRouter();
  const [interactive, setInteractive] = useState(interactiveDefault);

  const toggleMode = (checked: boolean) => {
    setInteractive(checked);
    // keep the two entry points deep-linkable without a navigation that
    // would discard what the user has typed
    window.history.replaceState(null, "", checked ? "/add/interactive" : "/add");
  };

  const form = useForm<DefineTerm>({
    resolver: zodResolver(DefineTermSchema),
    defaultValues: { term: "", examples: "", definition: "" },
  });

  const mutation = trpc.definitions.create.useMutation({
    onSuccess: ({ definition }) => router.push(`/definition/${definition.id}`),
  });

  const { data } = trpc.terms.list.useQuery(undefined);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <SparklesIcon className="size-4 text-ai" />
              Interactive AI refinement
            </div>
            <p className="text-sm text-muted-foreground">
              {interactive
                ? "After you add your definition, the model generates a suggested revision. Accept it, keep your original, or give feedback and request another pass. An accepted suggestion is published as a separate definition credited to you and the model."
                : "Your definition is added as-is. When a term is defined for the first time, the site also generates an independent AI definition for comparison."}
            </p>
          </div>
          <Switch
            checked={interactive}
            onCheckedChange={toggleMode}
            aria-label="Interactive AI refinement"
          />
        </div>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({ ...data, interactive }),
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="term"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Term</FormLabel>
                  <FormControl>
                    <AutoComplete
                      onValueChange={field.onChange}
                      options={data || []}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="definition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Definition</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Name the class of thing, then what distinguishes it. For austenite, 'A face-centered cubic phase of iron and its alloys, able to dissolve considerably more carbon than ferrite.'"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="examples"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Examples</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="A sentence using the term, such as 'Quenching steel from the austenite region traps carbon and forms martensite.'"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? "Creating..." : "Create"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};
