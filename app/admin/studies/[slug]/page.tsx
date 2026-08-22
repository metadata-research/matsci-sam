import Link from "next/link"
import { notFound } from "next/navigation"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  ListChecksIcon,
  MinusCircleIcon
} from "lucide-react"
import { AdminPageHeader } from "../../page-header"
import styles from "../../admin.module.css"
import {
  STUDIES,
  SUPPORT_LABEL,
  studyBySlug,
  type StepSupport
} from "@/lib/published-studies"

export const generateStaticParams = () =>
  STUDIES.map((study) => ({ slug: study.slug }))

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const study = studyBySlug(slug)

  return { title: study?.title ?? "Study" }
}

const SUPPORT_ICON: Record<StepSupport, typeof CheckCircle2Icon> = {
  supported: CheckCircle2Icon,
  partial: AlertTriangleIcon,
  missing: MinusCircleIcon
}

const SUPPORT_STYLE: Record<StepSupport, string> = {
  supported: styles.statusIconReady,
  partial: styles.statusIconWarning,
  missing: styles.statusIconMuted
}

export default async function AdminStudyPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const study = studyBySlug(slug)
  if (!study) notFound()

  return (
    <>
      <AdminPageHeader title={study.title} description={study.lede} />
      <div className={styles.sectionStack}>
        <Link href="/admin/studies" className={styles.textLink}>
          All studies
          <ArrowRightIcon aria-hidden />
        </Link>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>The setup</h2>
            <span className={styles.panelMeta}>
              {study.state === "completed" ? "Completed" : "Proposed"}
            </span>
          </div>
          <dl className="grid gap-4 px-5 pb-5 text-sm">
            <Fact label="Platform" value={study.platform} />
            <Fact label="Period" value={study.period} />
            <Fact label="Cohort" value={study.cohort} />
            <Fact label="Term set" value={study.termSet} />
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <ListChecksIcon aria-hidden />
              Protocol
            </h2>
            <span className={styles.panelMeta}>
              {study.protocol.length} steps, in order
            </span>
          </div>
          <ol className="flex flex-col gap-5 px-5 pb-5">
            {study.protocol.map((step, index) => {
              const Icon = SUPPORT_ICON[step.support]

              return (
                <li key={step.title} className="flex gap-4">
                  <span className={styles.statValue} aria-hidden>
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {step.detail}
                    </p>
                    <p className="mt-1 flex items-start gap-2 text-sm">
                      <Icon
                        aria-hidden
                        className={`${styles.statusIcon} ${SUPPORT_STYLE[step.support]}`}
                      />
                      <span>
                        <span className="font-medium">
                          {SUPPORT_LABEL[step.support]}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          {step.supportNote}
                        </span>
                      </span>
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          <div className={styles.panelFooter}>
            <span className="text-sm text-muted-foreground">
              Support describes this application, not the platform the study ran
              on.
            </span>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              {study.state === "completed" ? "What it produced" : "What it owes"}
            </h2>
          </div>
          <ul className={styles.statusList}>
            {study.produced.map((item) => (
              <li
                className={`${styles.statusRow} ${styles.statusRowCompact}`}
                key={item}
              >
                <CheckCircle2Icon
                  aria-hidden
                  className={`${styles.statusIcon} ${styles.statusIconMuted}`}
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className={styles.panelFooter}>
            {study.sourceHref ? (
              <a
                href={study.sourceHref}
                className={styles.textLink}
                target="_blank"
                rel="noreferrer"
              >
                {study.source}
                <ExternalLinkIcon aria-hidden />
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">
                {study.source}
              </span>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-foreground">{value}</dd>
    </div>
  )
}
