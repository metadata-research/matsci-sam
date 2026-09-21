import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { SITE_FULL_NAME, SITE_NAME } from "@/lib/site"
import styles from "./about.module.css"

export const metadata: Metadata = {
  title: `About | ${SITE_NAME}`,
  description:
    "A community dictionary for materials science terminology, with definitions, examples, discussion, optional AI assistance, and reusable metadata."
}

export default function AboutPage() {
  return (
    <main className={styles.main}>
      <div className={styles.shell}>
        <header className={styles.introduction}>
          <h1>About {SITE_NAME}</h1>
          <p className={styles.lead}>
            {SITE_NAME} ({SITE_FULL_NAME}) supports the development of
            terminology for materials research and the metadata used to describe
            research data.
          </p>
          <p>
            Communities maintain vocabularies that reflect how terms are used in
            their fields. Contributors can compare definitions and discuss their
            use. Earlier versions remain available as definitions change.
          </p>
          <nav className={styles.linkRow} aria-label="Get started">
            <Link href="/docs" className={styles.textLink}>
              Quick Start <ArrowRightIcon aria-hidden />
            </Link>
            <Link href="/terms" className={styles.textLink}>
              Browse terms <ArrowRightIcon aria-hidden />
            </Link>
            <Link href="/add" className={styles.textLink}>
              Contribute <ArrowRightIcon aria-hidden />
            </Link>
          </nav>
        </header>

        <div className={styles.features}>
          <section
            id="definition-workflow"
            className={styles.section}
            aria-labelledby="community-heading"
          >
            <h2 id="community-heading">Find and discuss terminology</h2>
            <p>
              Anyone can search, browse, and link to published terms without
              signing in. Collections can include links to terms from several
              vocabularies.
            </p>
            <p>
              Signed-in contributors can add definitions and examples, comment,
              and vote. A term can have several definitions, each with its own
              examples and discussion. Authors can publish new versions of their
              definitions. Votes record support for the revision being reviewed.
            </p>
          </section>

          <section
            className={styles.section}
            aria-labelledby="assistance-heading"
          >
            <h2 id="assistance-heading">Optional AI assistance</h2>
            <p>
              Contributors can request a draft from a language model using the
              text and references they select. Suggestions remain separate from
              the definition until accepted. Contributors can edit the text
              before publication, and the contribution record identifies the
              model used.
            </p>
            <Link href="/docs/provenance" className={styles.textLink}>
              Read about contribution history <ArrowRightIcon aria-hidden />
            </Link>
          </section>

          <section
            className={styles.section}
            aria-labelledby="references-heading"
          >
            <h2 id="references-heading">Definitions from reference sources</h2>
            <p>
              Contributors can consult definitions from ChEBI while writing.
              They can incorporate source text into a definition or cite a
              source used in their own wording. Published citations identify the
              source and preserve the reference text.
            </p>
          </section>

          <section
            className={styles.section}
            aria-labelledby="ontologies-heading"
          >
            <h2 id="ontologies-heading">Relationships in ontologies</h2>
            <p>
              Contributors will be able to view a term within ontology
              hierarchies available through MatSci-ONT, including its
              relationships to broader and narrower concepts. They will be able
              to switch between ontologies when corresponding entries are
              available and compare the relationships recorded in each.
            </p>
          </section>
        </div>

        <section
          className={styles.reuseSection}
          aria-labelledby="reuse-heading"
        >
          <div className={styles.section}>
            <h2 id="reuse-heading">Reference and reuse vocabulary records</h2>
            <p>
              Terms, definitions, and revisions have distinct identifiers.{" "}
              {SITE_NAME} preserves these identifiers when definition text
              changes. A term identifier refers to the term and its definitions.
              A definition identifier refers to the same definition after edits.
              Use a revision identifier to cite the exact text of one version.
            </p>
            <p>
              Vocabulary records and contribution history are also available in
              formats that software can process. Exported metadata includes
              definitions, contributor attribution, dates, and recorded
              activities.
            </p>
            <div className={styles.linkRow}>
              <Link href="/docs/identifiers" className={styles.textLink}>
                Persistent identifiers and citation
                <ArrowRightIcon aria-hidden />
              </Link>
              <Link href="/docs/reference" className={styles.textLink}>
                Technical reference <ArrowRightIcon aria-hidden />
              </Link>
            </div>
          </div>
          <dl className={styles.metadataList}>
            <div>
              <dt>SKOS</dt>
              <dd>Terms, definitions, and examples</dd>
            </div>
            <div>
              <dt>Dublin Core</dt>
              <dd>Attribution and dates</dd>
            </div>
            <div>
              <dt>PROV-O</dt>
              <dd>Contribution activities and their history</dd>
            </div>
          </dl>
        </section>

        <section
          className={styles.background}
          aria-labelledby="background-heading"
        >
          <h2 id="background-heading">Project background</h2>
          <p>
            {SITE_NAME} is based on the{" "}
            <a href="https://www.yamz.net/about">YAMZ metadata dictionary</a>{" "}
            and supports community contributions to materials science
            terminology. Definitions are organized in community vocabularies,
            with version histories and records of AI assistance.
          </p>
          <p>
            The project is developed by the{" "}
            <a href="https://mrc.cci.drexel.edu/">
              Metadata Research Center at Drexel University
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
