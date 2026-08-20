import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon, ExternalLinkIcon, InfoIcon } from "lucide-react"
import {
  dftMatCoreElements,
  matCoreSourceSnapshot,
  minimalMatCoreElements,
  syntheticSiliconDftRecord,
  type MatCoreElement
} from "@/lib/matcore"
import { matCoreElementUri } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import styles from "./matcore.module.css"

export const metadata: Metadata = {
  title: `MatCore metadata | ${SITE_NAME}`,
  description:
    "A read-only MatSci-SAM transcription of the preliminary Minimal and DFT metadata elements published in the 2025 MatCore paper."
}

const publishedDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
}).format(new Date(`${matCoreSourceSnapshot.publishedDate}T00:00:00Z`))

const minimalRequiredCount = minimalMatCoreElements.filter(
  (element) => element.required
).length

export default function MatCoreMetadataPage() {
  return (
    <main className={styles.main}>
      <div className={styles.shell}>
        <div className={styles.content}>
          <header className={styles.introduction}>
            <h1>MatCore metadata</h1>
            <p className={styles.lead}>
              A preliminary two-level metadata model for computational materials
              datasets.
            </p>
            <div className={styles.sourceLine}>
              <a
                href={matCoreSourceSnapshot.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={styles.sourceLink}
              >
                Read the source paper
                <ExternalLinkIcon aria-hidden />
              </a>
              <span>{matCoreSourceSnapshot.snapshotLabel}</span>
              <span>{publishedDate}</span>
              <span>{SITE_NAME} transcription</span>
            </div>
            <p className={styles.notice}>
              <InfoIcon aria-hidden />
              <span>
                Preliminary snapshot—not an official or current MatCore release.
              </span>
            </p>
            <p className={styles.machineNote}>
              Every element below has an identifier of its own, formed from this
              address and the element key, so <code>#creator</code> names the
              Creator element. The same identifiers appear in{" "}
              <Link href="/dataset.ttl">the published RDF</Link>, where the
              elements that correspond to a Dublin Core property say so.{" "}
              <Link href="/docs/reference/matcore-and-the-vocabulary">
                How MatCore relates to the vocabulary
              </Link>
              .
            </p>
          </header>

          <article
            className={styles.specification}
            aria-label="Preliminary MatCore metadata specification snapshot"
          >
            <FieldProfile
              id="minimal"
              title="Minimal MatCore Metadata"
              summary={`${minimalMatCoreElements.length} elements · ${minimalRequiredCount} required · applies to every computational dataset`}
              elements={minimalMatCoreElements}
            />

            <FieldProfile
              id="dft"
              title="DFT module"
              summary={`${dftMatCoreElements.length} elements · optional method-specific tier`}
              elements={dftMatCoreElements}
              requirementNote={
                <>
                  If the DFT module is supplied, <code>xc-functional</code>,{" "}
                  <code>potential</code>, and <code>basis-set</code> are
                  required within it.
                </>
              }
            >
              <p className={styles.moduleNote}>
                <InfoIcon aria-hidden />
                <span>
                  Molecular dynamics, GW/BSE, machine learning, and Derivative
                  modules are named in the paper, but their element tables are
                  not included in this source.
                </span>
              </p>
            </FieldProfile>

            <details className={styles.example} open>
              <summary>
                <ChevronRightIcon
                  className={styles.exampleChevron}
                  aria-hidden
                />
                <span className={styles.exampleTitle}>
                  Illustrative DFT record: silicon lattice relaxation
                </span>
                <span className={styles.exampleMarker}>Synthetic example</span>
              </summary>
              <p className={styles.exampleIntroduction}>
                {syntheticSiliconDftRecord.caveat}
              </p>
              <div className={styles.exampleProfiles}>
                <RecordProfile
                  title="Minimal metadata"
                  elements={minimalMatCoreElements}
                  values={syntheticSiliconDftRecord.values.minimal}
                />
                <RecordProfile
                  title="DFT metadata"
                  elements={dftMatCoreElements}
                  values={syntheticSiliconDftRecord.values.dft}
                />
              </div>
              <div className={styles.exampleFooter}>
                <span>
                  This example demonstrates structure; MatSci-SAM is not storing
                  or validating a dataset record here.
                </span>
                <Link
                  href="/vocabulary/density_functional_theory_dft"
                  className={styles.vocabularyLink}
                >
                  Open DFT in the vocabulary
                  <ChevronRightIcon aria-hidden />
                </Link>
              </div>
            </details>
          </article>

          <p className={styles.sourceFooter}>
            Source:{" "}
            <cite>
              {matCoreSourceSnapshot.citationLabel},{" "}
              {matCoreSourceSnapshot.title}
            </cite>
            . The element descriptions on this page are concise MatSci-SAM
            paraphrases of Figures 3 and 5.
          </p>
        </div>
      </div>
    </main>
  )
}

function FieldProfile({
  id,
  title,
  summary,
  elements,
  requirementNote,
  children
}: {
  id: string
  title: string
  summary: string
  elements: readonly MatCoreElement[]
  requirementNote?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section className={styles.profile} aria-labelledby={`${id}-heading`}>
      <div className={styles.profileHeader}>
        <h2 id={`${id}-heading`}>{title}</h2>
        <p>{summary}</p>
      </div>
      {requirementNote ? (
        <p className={styles.conditionalRule}>{requirementNote}</p>
      ) : null}
      <div className={styles.fieldHeader} aria-hidden>
        <span>Source key</span>
        <span>Status</span>
        <span>Description</span>
      </div>
      <ul className={styles.fieldList}>
        {elements.map((element) => (
          // The row id is the element key, so the published IRI
          // /metadata/matcore#<key> resolves to the row that describes it.
          <li key={element.key} id={element.key} className={styles.fieldRow}>
            <a
              href={`#${element.key}`}
              className={styles.fieldKey}
              title={matCoreElementUri(element.key)}
            >
              <code>{element.sourceKey}</code>
            </a>
            <span
              className={`${styles.requirement} ${
                element.required ? styles.requirementRequired : ""
              }`}
            >
              {element.required ? "Required" : "Optional"}
            </span>
            <div className={styles.fieldBody}>
              <p className={styles.fieldDescription}>{element.description}</p>
              {(element.crosswalk || element.rangeIsVocabulary) && (
                <p className={styles.fieldNotes}>
                  {element.crosswalk && (
                    <span className={styles.fieldNote}>
                      {element.crosswalk.relation === "exact"
                        ? "Same as "
                        : "Narrows "}
                      <code>{element.crosswalk.property}</code>
                    </span>
                  )}
                  {element.rangeIsVocabulary && (
                    <span className={styles.fieldNote}>
                      Values come from the{" "}
                      <Link href="/vocabulary">MatSci-SAM vocabulary</Link>
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {children}
    </section>
  )
}

function RecordProfile<Key extends string>({
  title,
  elements,
  values
}: {
  title: string
  elements: readonly MatCoreElement<Key>[]
  values: Readonly<Record<Key, string>>
}) {
  return (
    <section className={styles.exampleProfile}>
      <h3>{title}</h3>
      <dl className={styles.recordList}>
        {elements.map((element) => (
          <div key={element.key} className={styles.recordRow}>
            <dt>{element.sourceKey}</dt>
            <dd>{values[element.key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
