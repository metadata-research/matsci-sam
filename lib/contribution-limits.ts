/** Shared by server enforcement, input validation and client controls. */
export const CONTRIBUTION_LIMITS = {
  definition: { count: 5, seconds: 600 },
  comment: { count: 10, seconds: 60 },
  example: { count: 10, seconds: 60 }
} as const
