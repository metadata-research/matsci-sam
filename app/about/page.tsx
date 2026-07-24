import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRightIcon,
  BracesIcon,
  FilePlus2Icon,
  HistoryIcon,
  MessageSquareTextIcon,
  SparklesIcon
} from "lucide-react"
import { SITE_NAME } from "@/lib/site"
import styles from "./about.module.css"

export const metadata: Metadata = {
  title: `About | ${SITE_NAME}`,
  description:
    "How MatSci SAM combines community review, human-controlled AI assistance, and standards-based provenance to develop shared materials science terminology."
}

export default function AboutPage() {
  return (
    <main className={styles.main}>
      <div className={styles.shell}>
        <header className={styles.introduction}>
          <p className={styles.eyebrow}>Project and method</p>
          <h1>About {SITE_NAME}</h1>
          <p className={styles.lead}>
            {SITE_NAME} (Semantic Alignment and Standardization) is a community
            metadata dictionary for developing shared materials science
            terminology through expert contributions, discussion, and
            human-in-the-group AI.
          </p>
          <p>
            Developed by the{" "}
            <a
              href="https://mrc.cci.drexel.edu/"
              target="_blank"
              rel="noreferrer"
            >
              Metadata Research Center at Drexel University
            </a>
            , the project records definitions as structured metadata and
            preserves how people and named models contribute to their
            refinement. The resulting vocabulary supports clearer data
            description and the reuse of materials science results.
          </p>
          <p className={styles.guidePrompt}>
            Looking for instructions?{" "}
            <Link href="/docs">Open the MatSci SAM user guide.</Link>
          </p>
        </header>

        <section
          id="definition-workflow"
          className={styles.workflowSection}
          aria-labelledby="workflow-heading"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Community method</p>
            <h2 id="workflow-heading">How a definition develops</h2>
            <p>
              A contribution is available for review when it is submitted.
              Community evaluation and author-controlled refinement then build a
              visible history around it.
            </p>
          </div>

          <ol className={styles.workflow}>
            <WorkflowStep
              icon={<FilePlus2Icon />}
              number="1"
              title="Contribute"
            >
              Add a term, definition, and example of use for community review.
            </WorkflowStep>
            <WorkflowStep
              icon={<MessageSquareTextIcon />}
              number="2"
              title="Evaluate"
            >
              Compare alternatives through votes and substantive comments.
            </WorkflowStep>
            <WorkflowStep icon={<SparklesIcon />} number="3" title="Refine" ai>
              A locally hosted model can suggest text. The author decides
              whether to accept it.
            </WorkflowStep>
            <WorkflowStep icon={<HistoryIcon />} number="4" title="Preserve">
              Retain attribution, versions, decisions, and model involvement in
              a traceable record.
            </WorkflowStep>
          </ol>

          <p className={styles.workflowDecision}>
            The author can accept a model suggestion, keep the original, or
            request another pass. An accepted suggestion is attributed to both
            the author and the named model.
          </p>
          <div className={styles.linkRow}>
            <Link href="/docs/community" className={styles.textLink}>
              Review scoring and revision policy
              <ArrowRightIcon aria-hidden />
            </Link>
            <Link href="/docs/ai-refinement" className={styles.textLink}>
              Read about AI-assisted refinement
              <ArrowRightIcon aria-hidden />
            </Link>
          </div>
        </section>

        <section
          className={styles.standardsSection}
          aria-labelledby="standards-heading"
        >
          <div className={styles.standardsCopy}>
            <p className={styles.eyebrow}>Open metadata</p>
            <h2 id="standards-heading">
              Vocabulary content and curation history are machine-readable
            </h2>
            <p>
              SKOS represents terms, definitions, and examples. Dublin Core
              records contributors and dates. PROV-O expresses revisions,
              comments, votes, and AI-assisted refinement activities. Together,
              these formats support FAIR access and reuse.
            </p>

            <dl className={styles.standardsList}>
              <div>
                <dt>SKOS</dt>
                <dd>Terms and definitions</dd>
              </div>
              <div>
                <dt>Dublin Core</dt>
                <dd>Attribution and dates</dd>
              </div>
              <div>
                <dt>PROV-O</dt>
                <dd>Curation history</dd>
              </div>
              <div>
                <dt>FAIR</dt>
                <dd>Access and reuse</dd>
              </div>
            </dl>

            <div className={styles.linkRow}>
              <Link href="/metadata/matcore" className={styles.textLink}>
                Explore MatCore metadata
                <ArrowRightIcon aria-hidden />
              </Link>
              <Link href="/docs/metadata-access" className={styles.textLink}>
                Read the metadata guide
                <ArrowRightIcon aria-hidden />
              </Link>
              <Link href="/docs/provenance" className={styles.textLink}>
                Understand provenance
                <ArrowRightIcon aria-hidden />
              </Link>
              <a href="/vocabulary.ttl" className={styles.textLink}>
                Download the vocabulary
                <ArrowRightIcon aria-hidden />
              </a>
            </div>
          </div>

          <div
            className={styles.recordEvidence}
            aria-label="Example machine-readable record fields"
          >
            <div className={styles.recordEvidenceHeading}>
              <span>
                <BracesIcon aria-hidden />
                Record fields
              </span>
              <span>Turtle</span>
            </div>
            <pre>
              <code>
                <span>skos:prefLabel</span>
                {`          "martensite"@en\n`}
                <span>skos:definition</span>
                {`         "Community definition..."@en\n`}
                <span>dcterms:contributor</span>
                {`     "Contributor"\n`}
                <span>prov:wasGeneratedBy</span>
                {`     refinement-round`}
              </code>
            </pre>
            <p>
              The vocabulary record describes the published content. The
              provenance record describes the activities that produced it.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

function WorkflowStep({
  icon,
  number,
  title,
  ai = false,
  children
}: {
  icon: React.ReactNode
  number: string
  title: string
  ai?: boolean
  children: React.ReactNode
}) {
  return (
    <li className={ai ? styles.workflowAi : undefined}>
      <div className={styles.workflowIcon}>{icon}</div>
      <div className={styles.workflowHeading}>
        <span>{number}</span>
        <h3>{title}</h3>
      </div>
      <p>{children}</p>
    </li>
  )
}
