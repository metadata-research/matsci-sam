"use client"

import type { User } from "@yamz/db"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { EditProfile, EditProfileSchema } from "@/lib/schemas/profile"
import { trpc } from "@/trpc/client"

export const EditProfileForm = ({ defaults }: { defaults: User }) => {
  const router = useRouter()
  const form = useForm<EditProfile>({
    resolver: zodResolver(EditProfileSchema),
    defaultValues: {
      firstName: defaults.firstName || "",
      lastName: defaults.lastName || "",
      affiliation: defaults.affiliation || ""
    }
  })

  const { mutate, isPending } = trpc.user.edit.useMutation({
    onSuccess: () => {
      toast.success("Profile updated.")
      router.push("/profile")
      router.refresh()
    },
    onError: () => toast.error("The profile could not be updated.")
  })

  return (
    <Card>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => mutate(data))}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="affiliation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Affiliation</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="University, laboratory, or organization"
                      autoComplete="organization"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : "Save profile"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
