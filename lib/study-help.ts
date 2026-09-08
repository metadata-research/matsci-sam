// These excerpts come from the rendered study guide, so the walkthrough and
// /docs/studies cannot acquire separate explanations of the same action.
export type StudyHelpSection = { id: string; title: string; html: string }

const HELP_SECTIONS = new Set([
  "help-in-the-study",
  "terms-used-in-the-study",
  "voting-on-the-terms",
  "written-feedback",
  "the-position-step",
  "reviewing-the-definitions",
  "the-closing-questions",
  "saving-and-returning",
  "study-and-vocabulary-workflows"
])

export const studyHelpFromHtml = (html: string): StudyHelpSection[] => {
  const headings = [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)]
  return headings.flatMap((heading, index) => {
    if (!HELP_SECTIONS.has(heading[1])) return []
    return [
      {
        id: heading[1],
        title: heading[2].replace(/<[^>]+>/g, ""),
        // Documentation links open separately so reading help cannot unmount a
        // participant's unfinished proposal, critique, comment, or answer.
        html: html
          .slice(heading.index, headings[index + 1]?.index)
          .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')
      }
    ]
  })
}

export const studyHelpTopic = (
  kind: "instructions" | "define" | "review" | "question" | undefined,
  votingOnly = false
) => {
  switch (kind) {
    case "instructions":
      return "instructions"
    case "define":
      return votingOnly ? "voting-on-the-terms" : "the-position-step"
    case "review":
      return "reviewing-the-definitions"
    case "question":
      return votingOnly ? "written-feedback" : "the-closing-questions"
    default:
      return "saving-and-returning"
  }
}

export const studyHelpSectionsFor = (
  sections: StudyHelpSection[],
  votingOnly: boolean
) =>
  sections.filter((section) =>
    votingOnly
      ? ![
          "the-position-step",
          "reviewing-the-definitions",
          "the-closing-questions"
        ].includes(section.id)
      : !["voting-on-the-terms", "written-feedback"].includes(section.id)
  )
