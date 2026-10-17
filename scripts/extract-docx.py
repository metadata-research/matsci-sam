#!/usr/bin/env python3
"""Bounded DOCX raw text only. Never extract paths, execute or resolve links."""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_ENTRIES = 512
MAX_TOTAL = 20 * 1024 * 1024
MAX_ENTRY = 8 * 1024 * 1024
MAX_TEXT = 200000
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def fail(code):
    print(json.dumps({"error": code}))
    sys.exit(0)


try:
    with zipfile.ZipFile(sys.argv[1]) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES or sum(e.file_size for e in entries) > MAX_TOTAL:
            fail("archive_limit")
        names = [e.filename for e in entries]
        if len(names) != len(set(names)):
            fail("invalid_docx")
        for entry in entries:
            if (entry.file_size > MAX_ENTRY or entry.flag_bits & 1 or
                    entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or
                    entry.file_size > max(1, entry.compress_size) * 200 or
                    entry.filename.startswith("/") or "\\" in entry.filename or
                    ".." in entry.filename.split("/") or "\x00" in entry.filename):
                fail("archive_limit")
        if not {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}.issubset(names):
            fail("invalid_docx")
        content_types = archive.read("[Content_Types].xml")
        if (b"macroEnabled" in content_types or any("vbaproject" in n.lower() for n in names) or
                b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" not in content_types):
            fail("invalid_docx")
        selected = ["word/document.xml"] + sorted(
            n for n in names if re.fullmatch(r"word/(?:footnotes|endnotes|header\d+|footer\d+)\.xml", n)
        )
        paragraphs = []
        size = 0
        for part in selected:
            raw = archive.read(part)
            if b"\x00" in raw or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                fail("invalid_docx")
            tree = ET.fromstring(raw)
            for paragraph in tree.iter(W + "p"):
                pieces = []
                for element in paragraph.iter():
                    if element.tag == W + "t":
                        pieces.append(element.text or "")
                    elif element.tag == W + "tab":
                        pieces.append("\t")
                    elif element.tag in (W + "br", W + "cr"):
                        pieces.append("\n")
                    elif element.tag == W + "softHyphen":
                        pieces.append("\u00ad")
                text = "".join(pieces).strip()
                if text:
                    size += len(text) + 2
                    if size > MAX_TEXT:
                        fail("text_limit")
                    paragraphs.append({"text": text, "part": part})
        print(json.dumps({"paragraphs": paragraphs, "pythonVersion": sys.version.split()[0]}, ensure_ascii=False))
except (zipfile.BadZipFile, ET.ParseError, OSError, RuntimeError, KeyError, ValueError):
    fail("invalid_docx")
