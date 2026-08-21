import Link from "next/link"
import { ArrowRightIcon, FlaskConicalIcon } from "lucide-react"
import { AdminPageHeader } from "../page-header"
import styles from "../admin.module.css"
import { STUDIES } from "@/lib/studies"

export const metadata = {
  title: "Studies"
}

export default function AdminStudiesPage() {
  return (
    <>
      <AdminPageHeader
        title="Studies"
        description="The published studies this platform answers to, and the second ID4 study they are the template for."
      />
      <div className={styles.sectionStack}>
        <p className={styles.sectionDescription}>
          A study joins a cohort of people to a set of terms and runs them
          through an ordered protocol. Both studies below ran on predecessor
          software, and neither is stored here. They are written down so the
          protocol work can be scoped against what the papers actually did.
        </p>

        {STUDIES.map((study) => (
          <section className={styles.panel} key={study.slug}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                <FlaskConicalIcon aria-hidden />
                {study.title}
              </h2>
              <span className={styles.panelMeta}>
                {study.state === "completed" ? "Completed" : "Proposed"}
              </span>
            </div>
            <p className="px-5 text-sm text-muted-foreground">{study.lede}</p>
            <dl className="grid gap-3 px-5 pt-4 text-sm sm:grid-cols-3">
              <Fact label="Platform" value={study.platform} />
              <Fact label="Cohort" value={study.cohort} />
              <Fact label="Terms" value={study.termSet} />
            </dl>
            <div className={styles.panelFooter}>
              <Link
                href={`/admin/studies/${study.slug}`}
                className={styles.textLink}
              >
                Read the protocol
                <ArrowRightIcon aria-hidden />
              </Link>
            </div>
          </section>
        ))}
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
