import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"
import { AdminPageHeader } from "../../page-header"
import styles from "../../admin.module.css"
import {
  adminInvitationsOfStudy,
  adminStudyById
} from "@/lib/admin-study-queries"
import { instructionEditability } from "@/lib/study-editor"
import { studyAcceptsParticipants, studyState } from "@/lib/communities"
import { DEFAULT_INSTRUCTIONS, isDefaultInstructions } from "@/lib/surveys"
import { studyBySlug as referenceStudyBySlug } from "@/lib/published-studies"
import { studyPath } from "@/lib/public-identifiers"
import { Button } from "@/components/ui/button"
import { StudyEditor } from "../study-editor"
import { StudyInvitations } from "../study-invitations"

export const metadata = {
  title: "Edit study"
}

const UTC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
})

export default async function AdminStudyPage({
  params
}: {
  params: Promise<{ studyId: string }>
}) {
  const { studyId: segment } = await params
  const id = Number(segment)
  if (!Number.isSafeInteger(id) || id < 1) {
    if (referenceStudyBySlug(segment))
      redirect(`/admin/studies/reference/${encodeURIComponent(segment)}`)
    notFound()
  }

  const [study, invitations] = await Promise.all([
    adminStudyById(id),
    adminInvitationsOfStudy(id)
  ])
  if (!study) notFound()

  const editability = instructionEditability({
    steps: study.steps,
    usage: study.usage
  })
  const instructionsStep = study.steps.find(
    (step) => step.kind === "instructions" && step.position === 1
  )
  const effectiveInstructions = study.welcome ?? instructionsStep?.prompt ?? ""
  const hasCopyDrift =
    study.steps.length > 0 &&
    (study.welcome === null
      ? !isDefaultInstructions(instructionsStep?.prompt)
      : instructionsStep?.prompt !== study.welcome)
  const state = studyState(study)
  const parentRetired = Boolean(
    study.communityRetiredAt || study.collectionRetiredAt
  )

  return (
    <>
      <Link
        href="/admin/studies"
        className={`${styles.textLink} ${styles.studyBackLink}`}
      >
        <ArrowLeftIcon aria-hidden />
        All studies
      </Link>
      <AdminPageHeader
        title={study.title}
        description={`${study.communityTitle} · ${study.collectionTitle}`}
        actions={
          <Button asChild variant="outline">
            <Link href={studyPath(study.slug)} target="_blank">
              View public page
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLinkIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        }
      />

      <StudyInvitations
        study={{
          id: study.id,
          title: study.title,
          communityId: study.communityId
        }}
        acceptingParticipants={studyAcceptsParticipants(study)}
        invitations={invitations}
      />

      <StudyEditor
        key={[
          study.id,
          study.title,
          study.welcome,
          study.opensAt,
          study.closesAt,
          study.retiredAt
        ].join(":")}
        study={{
          id: study.id,
          slug: study.slug,
          title: study.title,
          welcome: study.welcome,
          opensAt: study.opensAt,
          closesAt: study.closesAt,
          retiredAt: study.retiredAt,
          parentRetired,
          createdLabel: `${UTC_DATE_TIME.format(new Date(study.createdAt))}${
            study.createdByName ? ` by ${study.createdByName}` : ""
          }`,
          communitySlug: study.communitySlug,
          communityTitle: study.communityTitle,
          collectionSlug: study.collectionSlug,
          collectionTitle: study.collectionTitle,
          steps: study.steps.length,
          activity: editability.activity,
          state,
          defaultInstructions: DEFAULT_INSTRUCTIONS,
          effectiveInstructions,
          instructionsEditable: editability.editable,
          instructionLockReason: editability.reason,
          hasCopyDrift
        }}
      />
    </>
  )
}
