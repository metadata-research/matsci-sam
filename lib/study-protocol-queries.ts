import { sql, type SQLWrapper } from "drizzle-orm"
import { ID4_ROUND_TWO } from "./study-protocol"

// SQL counterpart of isActiveStudyStep for aggregate progress cards. The
// alias is supplied by our queries, never by a request.
export const activeStudyStepSql = (
  studySlug: SQLWrapper,
  alias: string
) => sql`(
  ${studySlug} <> ${ID4_ROUND_TWO} or ${sql.identifier(alias)}.kind <> 'review'
)`
