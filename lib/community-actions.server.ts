import "server-only"
import { cache } from "react"
import { eq } from "drizzle-orm"
import { db, vocabularyWorkspaceSettingsTable } from "@yamz/db"
import { getActiveCommunity } from "./community-queries"
import type { CommunityActionContext } from "./community-actions"

export const getActiveContributionContext = cache(
  async (): Promise<CommunityActionContext> => {
    // getActiveCommunity verifies current membership before returning a scope.
    const active = await getActiveCommunity()
    if (!active) return {}
    const [settings] = await db
      .select({
        metadataEnabled: vocabularyWorkspaceSettingsTable.metadataEnabled
      })
      .from(vocabularyWorkspaceSettingsTable)
      .where(
        eq(
          vocabularyWorkspaceSettingsTable.vocabularySlug,
          active.vocabularySlug
        )
      )
    return {
      communityId: active.id,
      communitySlug: active.slug,
      vocabularySlug: active.vocabularySlug,
      metadataEnabled: settings?.metadataEnabled ?? false
    }
  }
)
