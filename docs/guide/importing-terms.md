# Importing terms

Import a CSV or TSV file to create private drafts for new terms. Review the
drafts before publishing. Existing terms and definitions stay unchanged.

## Prepare and preview

Open [Import terms](/setup?task=import), choose a vocabulary and, optionally,
a collection. Upload a UTF-8 file or paste its contents.

Use `term` and `definition` column headers. A term needs a name; its definition
can be blank until you are ready to publish. The preview accepts up to 100
rows. You can create as many drafts as fit your remaining account allowance,
up to 50 active drafts.

Select **Preview terms**. Choose which rows to save. Existing terms cannot be
imported again, and duplicate rows require a choice. Rename unsupported columns
or explicitly ignore them. Select **Create private drafts** to save the selected
rows to your account.

You can return to the import from [My drafts](/profile/drafts) on another device.
The original import stays private. Saving drafts does not publish terms or use
AI.

## Review text and evidence

Open a draft in the usual term editor. Check its wording and destination.
Sources and ontology references are optional. When they were supplied in the
import, explicitly include or omit them before publishing.

Original imported wording stays private by default. Select **Include original
wording in public provenance** in the draft editor if you want readers to see
it alongside your published definition. This choice is separate from including
source credit or citing a reference.

The extended template supports these fields:

| Fields | Purpose |
| --- | --- |
| `row_id`, `example`, `scope_note` | Identify a row and supply an example or usage context. |
| `source_title`, `source_url`, `source_creator`, `source_version`, `source_license` | Credit the source of the imported wording. |
| `source_keys` | Name documents you will attach later. Separate keys with semicolons, such as `handbook;lab-notes`. |
| `ontology_iri`, `ontology_label`, `ontology_name`, `ontology_version`, `ontology_source_url`, `ontology_note` | Propose a related external concept and explain how it relates to this term. |

Source credit does not automatically add a citation. Choose to cite a reference
when it supports the definition. Manually supplied references are identified as
contributor declarations; they are not verified lookup results.

Ontology references become proposed term metadata, including when an
administrator imports them. A curator reviews them separately. They do not
imply that two concepts are equivalent.

## Reuse a source

In a draft, upload a PDF, DOCX or plain-text file, or paste source text. The
import page lets you reuse that source in other selected drafts. Each draft
keeps its own citation choice, term check and selected passages.

Before using a source with an assistant, check that it contains the term or an
alias you supplied. Review OCR text from scanned PDFs. A source that does not
match cannot be sent to an assistant; you can still write the definition and
cite the source yourself.

Reusing a document does not record AI use. The provenance record includes AI
inputs only when you request assistance and publish the accepted suggestion.

## Publish selected terms

Select the drafts to publish and review their definitions, citations, attached
sources, metadata and collection membership. Publishing an attachment makes
the **whole file or pasted note** available to readers.

The current publication limit is five new definitions per account in ten
minutes. Review a group within the displayed allowance. If any selected draft
fails validation, none of the group is published. Other drafts stay private.

Changing a reviewed draft requires another review. After publication, readers
can see that the term was imported, any source credit and citations you included,
and recorded AI assistance. Original imported wording appears only if you chose
to share it. The import file, its hashes and unpublished rows stay private.
