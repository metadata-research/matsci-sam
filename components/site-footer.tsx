import Image from "next/image"
import Link from "next/link"
import { DatabaseIcon } from "lucide-react"
import styles from "./site-footer.module.css"

export function SiteFooter() {
  return (
    <footer className={styles.footer} aria-label="Site footer">
      <div className={styles.content}>
        <a
          href="https://mrc.cci.drexel.edu/"
          target="_blank"
          rel="noreferrer"
          className={styles.identity}
        >
          <Image
            src="/mrc-logo-navy-transparent.png"
            alt="Metadata Research Center"
            width={2699}
            height={595}
            sizes="256px"
          />
        </a>
        <div className={styles.nsfIdentity}>
          <Image
            src="/NSF_Logo.jpg"
            alt="National Science Foundation"
            width={219}
            height={230}
            sizes="48px"
          />
          <span>
            National Science Foundation
            <small>OAC #2118201</small>
          </span>
        </div>
        <nav className={styles.links} aria-label="Project information">
          <Link href="/docs/metadata-access">
            <DatabaseIcon aria-hidden />
            Metadata access
          </Link>
        </nav>
      </div>
    </footer>
  )
}
