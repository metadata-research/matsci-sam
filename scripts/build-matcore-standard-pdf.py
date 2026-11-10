#!/usr/bin/env python3
"""Reproduce the reviewed, privately supplied MatCore 0.5.0 PDF inventory.

Requires Poppler's pdftotext, not a network service. The exact PDF and the pinned
0.3.0 HTML are inputs outside the repository. Exact profile/path matches retain
their local identities; additions receive identities allocated for this release.
No source corpus is bundled with this parser.
"""
import argparse
from collections import Counter
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import unicodedata
import uuid
import xml.etree.ElementTree as ET

SOURCE_HASH = "2a1846512c2bac7982f5b445113a31bdb1dff9fc324ff6b9cb077654584ff0b7"
NS = {"x": "http://www.w3.org/1999/xhtml"}
VERSION = "0.5.0"
SOURCE_URL = "https://matcore.org/"
ARTIFACT_TITLE = "MatCore_Dev_baseline_2026-10-03.pdf (internally labeled MatCore v0.5.0)"
PREFIXES = {"Min": "minimal", "DFT": "dft", "MD": "md", "MBPT": "mbpt",
            "ML": "ml", "PF": "pf", "DER": "derived"}
CAPTION = re.compile(r"^(?:Table )?((?:Min|DFT|MD|MBPT|ML|PF|DER)-\d+):")
PROFILE = re.compile(r"^2\.([1-7]) ")
TABLE_COUNTS = {"Min-1": 44, "Min-2": 2, "Min-3": 15, "Min-4": 3, "Min-5": 4,
                "DFT-1": 27, "DFT-2": 4, "DFT-3": 8, "DFT-4": 5,
                "MD-1": 27, "MD-2": 4, "MD-3": 4, "MD-4": 4, "MBPT-1": 21,
                "ML-1": 27, "PF-1": 24, "PF-2": 3, "PF-3": 4, "PF-4": 4,
                "PF-5": 4, "PF-6": 4, "PF-7": 4, "DER-1": 4, "DER-2": 2, "DER-3": 4}


def baseline_parser():
    spec = importlib.util.spec_from_file_location("matcore_baseline", Path(__file__).with_name("build-matcore-standard.py"))
    parser = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parser)
    return parser


def normalized(value):
    return re.sub(r"\s+", " ", value).strip()


def paragraph(lines):
    # Join the continuation of a hyphenated PDF line without inserting a space.
    result = ""
    for line in lines:
        result += ("" if not result or result.endswith("-") else " ") + line
    return normalized(result)


def read_pdf_lines(source):
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError("Source hash differs from the reviewed 0.5.0 PDF; review before importing.")
    result = subprocess.run(["pdftotext", "-bbox-layout", str(source), "-"], check=True,
                            capture_output=True, timeout=25)
    pages = ET.fromstring(result.stdout).findall(".//x:page", NS)
    if len(pages) != 89:
        raise ValueError("Expected 89 pages in the reviewed PDF.")
    lines = []
    for number, page in enumerate(pages, 1):
        footer_found = False
        for line in page.findall(".//x:line", NS):
            words = [{"x": float(word.attrib["xMin"]), "text": "".join(word.itertext())}
                     for word in line.findall("x:word", NS)]
            text = " ".join(w["text"] for w in words)
            y = float(line.attrib["yMin"])
            if y > 550:
                if text not in ("MatCore v0.5.0", str(number)):
                    raise ValueError(f"Unexpected text in footer on page {number}.")
                footer_found |= text == "MatCore v0.5.0"
                continue
            lines.append({"page": number, "y": y, "x": float(line.attrib["xMin"]),
                          "text": text, "words": words})
        if not footer_found:
            raise ValueError(f"Missing version footer on page {number}.")
    return sorted(lines, key=lambda row: (row["page"], row["y"], row["x"]))


def parse_rows(table):
    """Separate the three columns geometrically, retaining PDF page locations."""
    rows = []
    pages = sorted(set(line["page"] for line in table["lines"]))
    pending = None
    for page in pages:
        lines = [line for line in table["lines"] if line["page"] == page]
        definitions = [line for line in lines if line["text"].startswith("Definition:")]
        if not definitions:
            if pending is None:
                raise ValueError(f"No definition column on page {page}, {table['id']}.")
            for line in lines:
                right = []
                for word in line["words"]:
                    if word["x"] >= description_x - 2:
                        right.append(word["text"])
                    elif re.fullmatch(r"[a-z][a-z-]*\*?", word["text"]):
                        pending["first" if word["x"] < 130 else "second"].append(word["text"])
                    else:
                        raise ValueError(f"Unexpected continuation on page {page}: {line['text']}")
                if right:
                    pending["description"].append(" ".join(right))
            continue
        description_x = min(line["x"] for line in definitions)
        starts = []
        for line in definitions:
            row = {"page": page, "y": line["y"], "first": [], "second": [], "description": []}
            starts.append(row)
            rows.append(row)
        for line in lines:
            if line["text"] in ("Property", "SubProperty", "Subproperty", "SubSubProperty", "SubSubproperty", "SubSubSubproperty", "Description"):
                continue
            left = [word for word in line["words"] if word["x"] < description_x - 2]
            right = [word["text"] for word in line["words"] if word["x"] >= description_x - 2]
            if left:
                continued_key = pending is not None and line["y"] < starts[0]["y"] - 35
                target = pending if continued_key else min(starts, key=lambda row: abs(row["y"] - line["y"]))
                if not continued_key and abs(target["y"] - line["y"]) > 35:
                    raise ValueError(f"Unassigned key on page {page}: {line['text']}")
                for word in left:
                    if not re.fullmatch(r"[a-z][a-z-]*\*?", word["text"]):
                        raise ValueError(f"Unexpected key on page {page}: {word['text']}")
                    target["first" if word["x"] < 130 else "second"].append(word["text"])
            if right:
                earlier = [row for row in starts if row["y"] <= line["y"] + 1]
                target = earlier[-1] if earlier else pending
                if target is None:
                    raise ValueError(f"Description before first field in {table['id']}.")
                target["description"].append(" ".join(right))
        pending = starts[-1]
    for row in rows:
        for column in ("first", "second"):
            row[column] = "".join(row[column])
        row["description"] = paragraph(row["description"])
        if not row["first"] and not row["second"]:
            raise ValueError(f"Missing key in {table['id']} page {row['page']}: {row['description'][:80]}")
    return rows


def extract_tables(lines):
    tables, descriptions, examples, example_labels = [], {}, {}, {}
    current = None
    profile = None
    mode = None
    for line in lines:
        text = line["text"]
        heading = PROFILE.match(text)
        caption = CAPTION.match(text)
        if heading:
            profile = list(PREFIXES.values())[int(heading[1]) - 1]
            descriptions[profile] = []
            examples[profile] = []
            mode, current = "preamble", None
        elif caption:
            table_id = caption[1]
            if PREFIXES[table_id.split("-")[0]] != profile:
                raise ValueError("Table/profile mismatch.")
            current = {"id": table_id, "profileId": profile, "page": line["page"],
                       "caption": text, "lines": []}
            tables.append(current)
            mode = "table"
        elif text.startswith("Example:"):
            example_labels[profile] = text
            mode, current = "example", None
        elif mode == "table":
            current["lines"].append(line)
        elif mode == "preamble":
            descriptions[profile].append(text)
        elif mode == "example":
            examples[profile].append(text)
    for table in tables:
        table["rows"] = parse_rows(table)
    if {table["id"]: len(table["rows"]) for table in tables} != TABLE_COUNTS:
        raise ValueError("Source table inventory differs from the reviewed 0.5.0 PDF.")
    return tables, descriptions, examples, example_labels


def source_links(text):
    return [{"label": url, "url": url} for url in dict.fromkeys(
        match.rstrip(".,;)") for match in re.findall(r"https?://[^\s<>]+", text))]


def reviewed_path(profile, path):
    # The supplied PDF renames this parent and retains its constituent structure.
    # Explicitly map its subtree; never fuzzy-match unrelated labels.
    return ["material-component", *path[1:]] if profile == "minimal" and path[0] == "material" else list(path)


def build_manifest(source, baseline_source):
    parser = baseline_parser()
    baseline = parser.build_manifest(baseline_source.read_bytes())
    tables, descriptions, examples, example_labels = extract_tables(read_pdf_lines(source))
    existing = {(o["profileId"], tuple(reviewed_path(o["profileId"], o["path"]))): o for o in baseline["occurrences"]}
    parent_paths = {}
    # The PDF preserves the reviewed baseline's table hierarchy. Do not infer
    # identity from a similar label: each subtable's first parent is checked below.
    for table in baseline["tables"]:
        if not table["id"].endswith("-1"):
            first = next(o for o in baseline["occurrences"] if o["sourceTableId"] == table["id"])
            parent_paths[table["id"]] = reviewed_path(first["profileId"], first["parentPath"])
    fields, occurrences, by_path = [], [], {}
    for table in tables:
        profile = table["profileId"]
        current_root = None
        parent = parent_paths.get(table["id"])
        if parent:
            source_parent = parser.key(table["rows"][0]["first"])
            expected = parent[-1]
            if source_parent != expected and not (
                table["id"] == "DFT-4" and source_parent == "localized-orbitals-basis-set"
                and expected == "localized-orbital-basis-set"
            ):
                raise ValueError(f"Unreviewed parent in {table['id']}: {source_parent}")
        for number, row in enumerate(table["rows"], 1):
            first, second = row["first"], row["second"]
            if parent is None:
                if first:
                    current_root = parser.key(first)
                if current_root is None:
                    raise ValueError("Missing main-table parent.")
                path = [current_root] + ([parser.key(second)] if second else [])
            else:
                path = parent + ([parser.key(second)] if second else [])
            definition, values, repeat, notes, warnings = parser.description_parts(html.escape(row["description"]))
            if table["id"] == "DFT-4":
                warnings.append("The PDF subtable says localized-orbitals-basis-set; its main-table field says localized-orbital-basis-set. The path retains the main-table spelling and existing field identity.")
            location = {"profileId": profile, "tableId": table["id"], "row": number,
                        "htmlRow": number, "page": row["page"], "anchor": f"page={row['page']}",
                        "url": SOURCE_URL, "rawKeyColumns": [first, second],
                        "rawText": row["description"], "rawHtml": "", "links": source_links(row["description"])}
            key = (profile, tuple(path))
            if key in by_path:
                field = by_path[key]
                if (table["id"] != "MD-3" or path != ["particle-interactions", "source"]
                        or field["definition"] != definition or field["repeatable"] != repeat):
                    raise ValueError(f"Unreviewed duplicate source path: {key}")
                field["additionalSources"].append(location)
                field["interpretationWarnings"].append("MD-3 repeats this parent definition from MD-1; both PDF locations are retained as one field occurrence.")
                continue
            previous = existing.get(key)
            identity = previous["fieldId"] if previous else "matcore-field:" + str(uuid.uuid5(
                uuid.NAMESPACE_URL, f"urn:matsci-sam:matcore:0.5.0:initial-identity:{profile}:{'.'.join(path)}"))
            field = {"id": identity, "sourceKey": parser.key(second or first),
                     "qualifiedLabel": " / ".join([parser.LABELS[profile]] + path),
                     "definition": definition, "valuesGuidance": values, "repeatable": repeat,
                     "notes": notes, "source": location, "additionalSources": [],
                     "interpretationWarnings": warnings}
            fields.append(field)
            by_path[key] = field
            occurrences.append({"id": f"matcore:{VERSION}:{profile}:{'.'.join(path)}",
                                "fieldId": identity, "profileId": profile, "path": path,
                                "parentPath": path[:-1] or None, "required": "*" in (second or first),
                                "repeatable": repeat, "inherited": False, "sourceTableId": table["id"]})
    missing = set(existing) - set(by_path)
    if missing or len(fields) != 255:
        raise ValueError(f"Unreviewed identity inventory: {len(fields)} fields, removed paths: {sorted(missing)}.")
    profiles = []
    for previous in baseline["profiles"]:
        profile = previous["id"]
        description = paragraph(descriptions[profile])
        example = "\n".join(examples[profile]).replace("\uec03", "").strip()
        profiles.append({**previous, "sourceAnchor": f"page={next(t['page'] for t in tables if t['profileId'] == profile)}",
                         "description": description, "inheritanceNote": description if previous["inherits"] else None,
                         "examples": [{"text": example, "sourceLinks": source_links(example_labels[profile] + " " + example)}]})
    return {"schemaVersion": 1, "standardKey": "matcore", "release": {
        "version": VERSION, "sourceUrl": SOURCE_URL, "sourceUrlRole": "publisher",
        "artifactTitle": ARTIFACT_TITLE, "retrievedOn": "2026-11-10", "sha256": SOURCE_HASH,
        "artifactPath": "MatCore_Dev_baseline_2026-10-03.pdf",
        "attribution": "MatCore working groups. Privately supplied PDF, internally labeled MatCore v0.5.0. The website link identifies the publisher, not this supplied document. No publication or approval status is inferred from the filename.",
        "license": None, "parserVersion": "matcore-0.5.0-pdf-inventory/1",
        "identityPolicy": "Exact profile/path matches retain local field IDs from the hash-verified 0.3.0 artifact. The explicitly reviewed minimal.material to minimal.material-component rename retains the seven subtree identities. Seven added paths receive new immutable IDs. Occurrence IDs are version-specific. Drafts and accepted proposals remain bound to their original source version; no proposal migration is performed."
        }, "profiles": profiles, "fields": fields, "occurrences": occurrences,
        "tables": [{"id": t["id"], "profileId": t["profileId"], "anchor": f"page={t['page']}",
                    "caption": t["caption"], "sourceRowCount": len(t["rows"])} for t in tables],
        "warnings": ["The supplied PDF is identified by its exact SHA-256 and internal version label. Its original download URL and publication status were not supplied.",
                     "PDF source locations record page and table row. rawHtml is empty; htmlRow is the logical row for schema compatibility.",
                     "The seven new minimal fields also apply to profiles inheriting Minimal, including Phase Field. Existing version-bound reviews are not retargeted.",
                     "PDF line wrapping and typographic differences are normalized for comparison; raw extracted wording is retained."] + [
                         f"{field['qualifiedLabel']}: {warning}" for field in fields for warning in field["interpretationWarnings"]]}


def comparison_text(value):
    value = unicodedata.normalize("NFKC", value)
    value = value.translate(str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "●": "", "•": "", "○": "", "–": "-", "−": "-"}))
    return normalized(value)


def compare_manifests(old, new):
    def index(manifest, map_paths=False):
        fields = {field["id"]: field for field in manifest["fields"]}
        return {(row["profileId"], tuple(reviewed_path(row["profileId"], row["path"]) if map_paths else row["path"])): (row, fields[row["fieldId"]]) for row in manifest["occurrences"]}
    before, after = index(old, True), index(new)
    changes = []
    for key in sorted(before.keys() | after.keys()):
        prior, current = before.get(key), after.get(key)
        record = {"profile": key[0], "path": list(key[1])}
        if prior is None or current is None:
            changes.append({**record, "kind": "added" if prior is None else "removed"})
            continue
        fields, formatting = {}, {}
        if prior[0]["path"] != current[0]["path"]:
            fields["path"] = {"before": prior[0]["path"], "after": current[0]["path"]}
        for name in ["definition", "valuesGuidance", "notes"]:
            a, b = prior[1][name], current[1][name]
            canon = lambda v: [comparison_text(x) for x in v] if isinstance(v, list) else comparison_text(v)
            if canon(a) != canon(b):
                compact = lambda v: re.sub(r"\s+", "", json.dumps(canon(v), ensure_ascii=False))
                target = formatting if compact(a) == compact(b) else fields
                target[name] = {"before": a, "after": b}
        for name in ["required", "repeatable"]:
            if prior[0][name] != current[0][name]:
                fields[name] = {"before": prior[0][name], "after": current[0][name]}
        if fields:
            changes.append({**record, "kind": "changed", "changes": fields})
        elif formatting:
            changes.append({**record, "kind": "formatting-only", "changes": formatting})
    return {"beforeVersion": old["release"]["version"], "afterVersion": new["release"]["version"],
            "beforeSha256": old["release"]["sha256"], "afterSha256": new["release"]["sha256"],
            "counts": {"before": len(before), "after": len(after), **dict(Counter(row["kind"] for row in changes))},
            "changes": changes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--baseline-source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--comparison", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    baseline = baseline_parser().build_manifest(args.baseline_source.read_bytes())
    manifest = build_manifest(args.source, args.baseline_source)
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if args.output.read_text() != serialized:
            raise SystemExit("Protected MatCore manifest differs from reproducible PDF parser output.")
    else:
        args.output.write_text(serialized)
        args.output.chmod(0o600)
    comparison = compare_manifests(baseline, manifest)
    if args.comparison:
        args.comparison.write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n")
        args.comparison.chmod(0o600)
    print(json.dumps({"version": VERSION, "fields": len(manifest["fields"]), "tables": len(manifest["tables"]),
                      "profiles": dict(Counter(o["profileId"] for o in manifest["occurrences"])), "comparison": comparison["counts"]}))


if __name__ == "__main__":
    main()
