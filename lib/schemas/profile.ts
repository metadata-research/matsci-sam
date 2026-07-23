import { z } from "zod"

export type EditProfile = z.infer<typeof EditProfileSchema>
export const EditProfileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  affiliation: z.string().trim().max(255),
  isProfilePublic: z.boolean()
})
