import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { SITE_FULL_NAME, SITE_NAME } from "@/lib/site"
import styles from "./about.module.css"

export const metadata: Metadata = {
  title: `About | ${SITE_NAME}`,
  description:
    "MatSci-SAM is a website from the Metadata Research Center at Drexel University for community vocabularies and metadata standards in materials science."
}

export default function AboutPage() {
  return (
    <main className={styles.main}>
      <div className={styles.shell}>
        <header className={styles.introduction}>
          <h1>About {SITE_NAME}</h1>
          <p className={styles.lead}>
            {SITE_NAME} is a website from the{" "}
            <a href="https://mrc.cci.drexel.edu/">
              Metadata Research Center at Drexel University
            </a>{" "}
            for community vocabularies and metadata standards in materials
            science.
          </p>
          <p>
            Researchers use {SITE_NAME} ({SITE_FULL_NAME}) to document how terms
            are used in their fields and develop metadata for research data.
            Contributors can compare definitions and propose changes, with
            attribution and revision history available for review.
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
            <h2 id="community-heading">Community vocabularies</h2>
            <p>
              Public terms are available to browse without an account.
              Communities can also restrict their content to members. Community
              members contribute terms and definitions to shared vocabularies,
              and collections group terms across vocabularies.
            </p>
            <p>
              A term can have several definitions, each with examples and
              discussion. Contributors can comment and vote on definitions after
              signing in and providing a name. Votes refer to the revision being
              reviewed, and earlier revisions remain available when authors
              update their definitions.
            </p>
          </section>

          <section
            className={styles.section}
            aria-labelledby="metadata-heading"
          >
            <h2 id="metadata-heading">Metadata development</h2>
            <p>
              Communities can develop metadata fields from an existing standard.
              Members propose changes to field definitions and requirements,
              discuss alternatives and respond to requests for feedback. Each
              proposal retains the reference version on which it was based.
            </p>
            <p>
              Community stewards review proposals and accept changes into a
              community version. They can publish named community releases while
              retaining the original reference and the record of decisions.
            </p>
          </section>

          <section
            className={styles.section}
            aria-labelledby="references-heading"
          >
            <h2 id="references-heading">Reference sources</h2>
            <p>
              Contributors can consult ontology definitions and cite sources
              while writing. Cited lookup results retain the reference text and
              available source details, including version and licence. Ontology
              views show direct parent concepts and mappings recorded by source
              publishers.
            </p>
          </section>

          <section
            className={styles.section}
            aria-labelledby="assistance-heading"
          >
            <h2 id="assistance-heading">Optional AI assistance</h2>
            <p>
              Contributors can request a draft from a language model through{" "}
              {SITE_NAME}, using their text, reference definitions or selected
              passages from uploaded documents and pasted text. They choose
              whether to use a suggestion and can edit it before publication.
              Accepted suggestions retain a record of the model and the source
              material supplied with the request.
            </p>
            <Link href="/docs/provenance" className={styles.textLink}>
              Contribution history <ArrowRightIcon aria-hidden />
            </Link>
          </section>
        </div>

        <section
          className={styles.reuseSection}
          aria-labelledby="reuse-heading"
        >
          <div className={styles.section}>
            <h2 id="reuse-heading">Citation and reuse</h2>
            <p>
              Terms, definitions and revisions have distinct identifiers for
              citation. Revision identifiers refer to the exact definition text
              published in a particular version.
            </p>
            <p>
              Public dictionary records and their contribution history can be
              downloaded for use in other tools. The exports use RDF
              vocabularies to describe definitions, attribution and recorded
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
            and extends that work to community vocabularies and metadata
            development in materials science.
          </p>
        </section>
      </div>
    </main>
  )
}
