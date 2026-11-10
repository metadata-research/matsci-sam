"""PDF parser regressions use invented text; no protected source is in git."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("pdf_parser", Path(__file__).with_name("build-matcore-standard-pdf.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def line(text, x, y, page=1):
    return {"text": text, "x": x, "y": y, "page": page,
            "words": [{"text": text, "x": x}]}


class PdfParserTests(unittest.TestCase):
    def test_rejects_unreviewed_pdf_before_poppler(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invented.pdf"
            path.write_bytes(b"not a reviewed source")
            with self.assertRaisesRegex(ValueError, "hash differs"):
                parser.read_pdf_lines(path)

    def test_columns_wrapped_keys_and_offset_definition(self):
        rows = parser.parse_rows({"id": "TEST-1", "lines": [
            line("Property", 77, 75), line("Subproperty", 190, 75), line("Description", 320, 75),
            line("Definition: Invented parent.", 320, 100), line("parent-", 77, 112),
            line("property*", 77, 126), line("Values: Text.", 320, 150),
            line("Repeatable: True", 320, 170),
            line("Definition: Invented child.", 320, 210), line("child*", 190, 210),
            line("Values: Scalar.", 320, 240), line("Repeatable: False", 320, 260)
        ]})
        self.assertEqual([(r["first"], r["second"]) for r in rows], [("parent-property*", ""), ("", "child*")])
        self.assertEqual(rows[0]["description"], "Definition: Invented parent. Values: Text. Repeatable: True")

    def test_key_and_description_continue_on_next_page(self):
        rows = parser.parse_rows({"id": "TEST-1", "lines": [
            line("parent-", 77, 500), line("child*", 190, 500),
            line("Definition: An invented", 320, 500),
            line("property", 77, 80, 2), line("definition.", 320, 80, 2),
            line("Values: Text.", 320, 100, 2), line("Repeatable: False", 320, 120, 2),
            line("sibling", 190, 160, 2), line("Definition: Another example.", 320, 160, 2),
            line("Values: Text.", 320, 190, 2), line("Repeatable: False", 320, 210, 2)
        ]})
        self.assertEqual(rows[0]["first"], "parent-property")
        self.assertIn("An invented definition.", rows[0]["description"])

    def test_only_headers_are_removed_not_guidance(self):
        rows = parser.parse_rows({"id": "TEST-1", "lines": [
            line("field", 77, 100), line("Definition: Invented example.", 320, 100),
            line("Values: Text.", 320, 130), line("Note: Keep the", 320, 150),
            line("SubProperty in this explanation.", 320, 170), line("Repeatable: True", 320, 190)
        ]})
        self.assertIn("SubProperty in this explanation.", rows[0]["description"])

    def test_last_row_continues_without_another_definition(self):
        rows = parser.parse_rows({"id": "TEST-1", "lines": [
            line("parent-", 77, 500), line("Definition: Invented.", 320, 500),
            line("property", 77, 80, 2), line("Values: Text.", 320, 80, 2),
            line("Repeatable: False", 320, 100, 2)
        ]})
        self.assertEqual(rows[0]["first"], "parent-property")
        self.assertTrue(rows[0]["description"].endswith("Repeatable: False"))

    def test_distant_or_non_key_text_fails_closed(self):
        for bad in [line("unassigned", 77, 300), line("not a key", 77, 100)]:
            with self.assertRaises(ValueError):
                parser.parse_rows({"id": "TEST-1", "lines": [line("Definition: Invented.", 320, 100), bad]})

    def test_only_reviewed_identity_rename_is_mapped(self):
        self.assertEqual(parser.reviewed_path("minimal", ["material", "example"]), ["material-component", "example"])
        self.assertEqual(parser.reviewed_path("pf", ["material", "example"]), ["material", "example"])
        self.assertEqual(parser.reviewed_path("minimal", ["other"]), ["other"])

    def test_whitespace_is_reported_separately_from_changed_rules(self):
        def manifest(version, value, repeat):
            return {"release": {"version": version, "sha256": version},
                    "fields": [{"id": "id", "definition": "Invented", "valuesGuidance": value, "notes": []}],
                    "occurrences": [{"profileId": "pf", "path": ["field"], "fieldId": "id", "repeatable": repeat, "required": False}]}
        old = manifest("old", "kg/m3", False)
        new = manifest("new", "kg/m 3", False)
        self.assertEqual(parser.compare_manifests(old, new)["counts"]["formatting-only"], 1)
        new["occurrences"][0]["repeatable"] = True
        changes = parser.compare_manifests(old, new)["changes"]
        self.assertEqual(changes[0]["kind"], "changed")
        self.assertIn("repeatable", changes[0]["changes"])

    def test_paragraph_wrap_and_visible_urls(self):
        self.assertEqual(parser.paragraph(["An invented short-", "range example."]), "An invented short-range example.")
        self.assertEqual(parser.source_links("Example (https://example.org/spec)."), [{"label": "https://example.org/spec", "url": "https://example.org/spec"}])


if __name__ == "__main__":
    unittest.main()
