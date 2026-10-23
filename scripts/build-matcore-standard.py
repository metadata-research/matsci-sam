#!/usr/bin/env python3
"""Reproduce the MatCore 0.3.0 inventory offline using Python's standard library.

This parser is intentionally pinned to one artifact. A changed upstream document
requires source review and an explicit identity mapping, not an automatic update.
HTML is preserved as evidence, never as trusted application markup.
"""
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urljoin
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://matcore.org/standard-document-content.html"
SOURCE_HASH = "c8ff435591a5535dfb7acb4d24fd810db378e84d95fbf8c6b6e19e746e876689"
PROFILES = ["minimal", "dft", "md", "mbpt", "ml", "pf", "derived"]
LABELS = {"minimal": "Minimal", "dft": "DFT", "md": "MD", "mbpt": "MBPT",
          "ml": "ML", "pf": "PF", "derived": "Derived Properties"}
COUNTS = {"minimal": 61, "dft": 44, "md": 39, "mbpt": 21,
          "ml": 27, "pf": 47, "derived": 10}

# Source-link correction is explicit, reviewable and retained in row warnings.
# The source's target does not exist. DER-2's caption, first key and surrounding
# tables establish the parent; this does not change any field's source wording.
BROKEN_TABLE_LINKS = {"kqjy6jm0fzl5": "2pk9ni1w02r2"}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "li", "br", "pre", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("p", "li", "pre", "tr"):
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def text(markup):
    parser = Text()
    parser.feed(markup)
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()


def links(markup):
    return [{"label": text(a[2]), "url": urljoin(SOURCE_URL, html.unescape(a[1]))}
            for a in re.findall(r'<a\b[^>]*href=([\"\'])(.*?)\1[^>]*>(.*?)</a>', markup, re.S)]


def key(raw):
    return raw.replace("*", "").strip()


def description_parts(markup):
    plain = text(markup)
    matches = list(re.finditer(r"\b(Definition|Values|Repeatable|Notes?|Note\s+\d+)\s*:\s*", plain))
    parts = {}
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(plain)
        parts.setdefault(match[1], []).append(plain[match.end():end].strip())
    if len(parts.get("Definition", [])) != 1:
        raise ValueError(f"Expected exactly one definition: {plain[:100]}")
    if len(parts.get("Values", [])) != 1:
        raise ValueError(f"Expected exactly one values statement: {plain[:100]}")
    repeat = parts.get("Repeatable", [])
    repeat_match = re.fullmatch(r"(True|False)\.?", repeat[0]) if len(repeat) == 1 else None
    repeatable = {"True": True, "False": False}[repeat_match[1]] if repeat_match else None
    notes = [f"{name}: {value}" for name, values in parts.items()
             if name.startswith("Note") for value in values]
    warnings = [] if repeatable is not None else ["Repeatability is not explicitly parseable; preserved as not specified."]
    return parts["Definition"][0], parts["Values"][0], repeatable, notes, warnings


def build_manifest(source):
    if hashlib.sha256(source).hexdigest() != SOURCE_HASH:
        raise ValueError("Source hash differs from the reviewed 0.3.0 artifact; review before importing.")
    document = source.decode("utf-8")
    sections = list(re.finditer(r'<section id="(minimal|dft|md|mbpt|ml|pf|derived)".*?</section>', document, re.S))
    if [s[1] for s in sections] != PROFILES:
        raise ValueError("Expected all seven source profiles in order.")
    profiles, tables, parsed_tables = [], [], []
    for section in sections:
        profile = section[1]
        first_table = section[0].index("<table>")
        preamble = section[0][:first_table]
        paragraphs = re.findall(r"<p(?:\s[^>]*)?>(.*?)</p>", preamble, re.S)
        description = text(paragraphs[0])
        inherited = [] if profile == "minimal" else ["minimal"]
        if profile == "mbpt":
            inherited.append("dft")
        examples = []
        for example in re.finditer(r'<pre><code>(.*?)</code></pre>', section[0], re.S):
            preceding = section[0][:example.start()]
            label = re.findall(r'<p(?:\s[^>]*)?>(.*?)</p>', preceding, re.S)[-1]
            examples.append({"text": html.unescape(example[1]).replace("\uec03", "").strip(),
                             "sourceLinks": links(label)})
        profiles.append({"id": profile, "label": LABELS[profile], "sourceAnchor": profile,
                         "description": description, "inherits": inherited,
                         "inheritanceNote": description if inherited else None,
                         "methodSelectionRequired": profile == "derived", "examples": examples})
        previous_end, count = 0, 0
        for table_number, table_match in enumerate(re.finditer(r"<table>.*?</table>", section[0], re.S), 1):
            preceding = section[0][previous_end:table_match.start()]
            previous_end = table_match.end()
            captions = re.findall(r"<p(?:\s[^>]*)?>(.*?)</p>", preceding, re.S)
            caption = text(captions[-1])
            table_id_match = re.search(r"(?:Table\s+)?((?:Min|DFT|MD|MBPT|ML|PF|DER)-\d+)", caption)
            if not table_id_match:
                raise ValueError(f"Missing table ID: {caption}")
            table_id = table_id_match[1]
            anchors = re.findall(r'id="([^"]+)"', preceding)
            anchor = anchors[-1] if table_number > 1 else profile
            rows = []
            for html_row, row in enumerate(re.findall(r"<tr>(.*?)</tr>", table_match[0], re.S), 1):
                cells = re.findall(r"<td(?:\s[^>]*)?>(.*?)</td>", row, re.S)
                if not cells:
                    continue
                if len(cells) != 3 or "Definition" not in text(cells[2]):
                    raise ValueError(f"Unexpected source row in {table_id}, tr {html_row}")
                rows.append({"html": row, "cells": cells, "row": len(rows) + 1, "htmlRow": html_row})
            count += len(rows)
            entry = {"id": table_id, "profileId": profile, "anchor": anchor,
                     "caption": caption, "sourceRowCount": len(rows)}
            tables.append(entry)
            parsed_tables.append({**entry, "main": table_number == 1, "rows": rows})
        if count != COUNTS[profile]:
            raise ValueError(f"Source row count changed for {profile}: {count}")

    by_anchor = {t["anchor"]: t for t in parsed_tables}
    fields, occurrences, warnings = [], [], []
    by_path, table_parents = {}, {}
    pending = list(parsed_tables)
    while pending:
        progress = False
        for table in list(pending):
            if not table["main"] and table["id"] not in table_parents:
                continue
            parent_path = table_parents.get(table["id"])
            current_root = None
            for row in table["rows"]:
                first, second = [text(c) for c in row["cells"][:2]]
                row_warnings = []
                if table["main"]:
                    if first:
                        current_root = key(first)
                    if not current_root:
                        raise ValueError(f"Missing parent in {table['id']}")
                    path = [current_root] + ([key(second)] if second else [])
                elif second:
                    path = parent_path + [key(second)]
                    if first and key(first) != parent_path[-1]:
                        row_warnings.append(f"Source parent key '{key(first)}' differs from linked property '{parent_path[-1]}'; path follows the explicit source table link.")
                else:
                    # MD-3 repeats its parent definition instead of a header.
                    if key(first) != parent_path[-1]:
                        raise ValueError(f"Unresolved parent row in {table['id']}")
                    path = parent_path
                source_key = key(second or first)
                definition, values, repeatable, notes, parse_warnings = description_parts(row["cells"][2])
                row_warnings.extend(parse_warnings)
                location = {"profileId": table["profileId"], "tableId": table["id"],
                            "row": row["row"], "htmlRow": row["htmlRow"], "anchor": table["anchor"],
                            "url": f"{SOURCE_URL}#{table['anchor']}", "rawKeyColumns": [first, second],
                            "rawText": text(row["cells"][2]), "rawHtml": row["html"], "links": links(row["cells"][2])}
                for link in re.findall(r'href="#([^"]+)"', row["cells"][2]):
                    target = BROKEN_TABLE_LINKS.get(link, link)
                    if target not in by_anchor:
                        raise ValueError(f"Unresolved table link #{link}")
                    target_id = by_anchor[target]["id"]
                    if target_id in table_parents and table_parents[target_id] != path:
                        raise ValueError(f"Reused table {target_id} needs multiple explicit occurrences.")
                    table_parents[target_id] = path
                    if target != link:
                        row_warnings.append(f"Source link #{link} is broken; {target_id} at #{target} is resolved by its caption and matching parent key. Source link is preserved.")
                identity_key = (table["profileId"], tuple(path))
                if identity_key in by_path:
                    field = by_path[identity_key]
                    if (table["id"] != "MD-3" or path != ["particle-interactions", "source"]
                            or field["definition"] != definition or field["repeatable"] != repeatable):
                        raise ValueError(f"Unreviewed duplicate source path: {identity_key}")
                    field["additionalSources"].append(location)
                    field["interpretationWarnings"].append("MD-3 repeats this parent definition from MD-1; both source locations are retained as one field occurrence.")
                    continue
                identity = uuid.uuid5(uuid.NAMESPACE_URL, f"{SOURCE_URL}#matcore-0.3.0-initial-identity/{table['profileId']}/{table['id']}/{row['row']}")
                field = {"id": f"matcore-field:{identity}", "sourceKey": source_key,
                         "qualifiedLabel": " / ".join([LABELS[table["profileId"]]] + path),
                         "definition": definition, "valuesGuidance": values, "repeatable": repeatable,
                         "notes": notes, "source": location, "additionalSources": [],
                         "interpretationWarnings": row_warnings}
                fields.append(field)
                by_path[identity_key] = field
                occurrences.append({"id": f"matcore:0.3.0:{table['profileId']}:{'.'.join(path)}",
                                    "fieldId": field["id"], "profileId": table["profileId"],
                                    "path": path, "parentPath": path[:-1] or None,
                                    "required": "*" in (second or first), "repeatable": repeatable,
                                    "inherited": False, "sourceTableId": table["id"]})
            pending.remove(table)
            progress = True
        if not progress:
            raise ValueError(f"Unresolved parent tables: {[t['id'] for t in pending]}")

    for field in fields:
        warnings.extend(f"{field['qualifiedLabel']}: {warning}" for warning in field["interpretationWarnings"])
    warnings.append("MD defines computation in its own profile and also inherits Minimal computation. These are distinct source identities; reconciliation of their scope remains a review question.")
    warnings.append("Derived Properties requires one selected method in addition to Minimal; the source disallows multiple-method combinations except MBPT, which inherits DFT. No method has been selected by this inventory.")
    return {
        "schemaVersion": 1, "standardKey": "matcore",
        "release": {"version": "0.3.0", "sourceUrl": SOURCE_URL, "retrievedOn": "2026-10-23",
                    "sha256": SOURCE_HASH, "artifactPath": "data/matcore/standard-0.3.0.html",
                    "attribution": "MatCore working groups, Material Core Standard (MatCore), version 0.3.0. Retrieved from the official MatCore website.",
                    "license": None, "parserVersion": "matcore-0.3.0-inventory/1",
                    "identityPolicy": "Local immutable IDs allocated for this baseline. They are not official MatCore identifiers. Reconcile future source versions explicitly; never regenerate identities from changed labels, table order or paths."},
        "profiles": profiles, "fields": fields, "occurrences": occurrences, "tables": tables,
        "warnings": warnings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check a protected manifest without writing")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = build_manifest(args.source.read_bytes())
    result = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if args.output.read_text() != result:
            raise SystemExit("Protected MatCore manifest differs from reproducible parser output.")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    print(f"MatCore 0.3.0: {len(manifest['profiles'])} profiles, {len(manifest['tables'])} tables, "
          f"{sum(t['sourceRowCount'] for t in manifest['tables'])} source rows, "
          f"{len(manifest['fields'])} fields, {len(manifest['occurrences'])} occurrences.")


if __name__ == "__main__":
    main()
