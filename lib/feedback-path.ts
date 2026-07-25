import { FEEDBACK_PAGE_PATH_MAX_LENGTH } from "@/lib/input-limits"

const unsafePathCharacter = /[%\\?#\u0000-\u001f\u007f]/
const nonPagePath = /^\/(?:api|_next)(?:\/|$)/
const traversalPathSegment = /(?:^|\/)\.{1,2}(?:\/|$)/

export function isFeedbackPagePath(path: string) {
  return (
    path.length > 0 &&
    path.length <= FEEDBACK_PAGE_PATH_MAX_LENGTH &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !unsafePathCharacter.test(path) &&
    !traversalPathSegment.test(path) &&
    !nonPagePath.test(path)
  )
}
