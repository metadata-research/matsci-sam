// Synthetic files only. No production documents or database snapshots.
import { randomBytes } from "node:crypto"
import { deflateSync } from "node:zlib"

const crc32 = (bytes: Buffer) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Valid PNG with random RGB pixels; neither zlib nor PostgreSQL can compress it. */
export function noisyPng() {
  const chunk = (type: string, content: Buffer) => {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(content.length)
    header.write(type, 4)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), content])))
    return Buffer.concat([header, content, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1024, 0)
  ihdr.writeUInt32BE(1024, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raster = Buffer.alloc(1024 * (1 + 1024 * 3))
  for (let y = 0; y < 1024; y++)
    randomBytes(1024 * 3).copy(raster, y * (1 + 1024 * 3) + 1)
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raster)),
    chunk("IEND", Buffer.alloc(0))
  ])
}

/** Valid PDF containing a noisy image and a readable source sentence. */
export function noisyPdf() {
  const rgb = randomBytes(1024 * 1024 * 3)
  const text =
    "BT /F1 18 Tf 20 760 Td (Legacy term source fixture.) Tj ET\nq 500 0 0 500 20 20 cm /Im1 Do Q\n"
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>"
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from(
      `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1024 /Height 1024 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgb.length} >>\nstream\n`
      ),
      rgb,
      Buffer.from("\nendstream")
    ])
  ]
  const chunks = [Buffer.from("%PDF-1.4\n")]
  const offsets = [0]
  let length = chunks[0].length
  objects.forEach((object, index) => {
    offsets.push(length)
    const bytes = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n")
    ])
    length += bytes.length
    chunks.push(bytes)
  })
  chunks.push(
    Buffer.from(
      `xref\n0 7\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          ""
        )}trailer\n<< /Root 1 0 R /Size 7 >>\nstartxref\n${length}\n%%EOF\n`
    )
  )
  return Buffer.concat(chunks)
}

/** A minimal DOCX package with a real image relationship, stored without compression. */
export function imageDocx(png: Buffer) {
  const entries = [
    [
      "[Content_Types].xml",
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    ],
    [
      "_rels/.rels",
      Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    ],
    [
      "word/document.xml",
      Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Legacy term is described in the DOCX source fixture.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
      )
    ],
    [
      "word/_rels/document.xml.rels",
      Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'
      )
    ],
    ["word/media/image1.png", png]
  ] as const
  const local: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc32(bytes), 14)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(filename.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc32(bytes), 16)
    central.writeUInt32LE(bytes.length, 20)
    central.writeUInt32LE(bytes.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE(offset, 42)
    local.push(header, filename, bytes)
    directory.push(central, filename)
    offset += header.length + filename.length + bytes.length
  }
  const directoryBytes = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directoryBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directoryBytes, end])
}

// A valid 1x1 JPEG; the volume case is provided by noisy PNG/PDF/DOCX files.
export const jpegFixture = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCVAAP/2Q==",
  "base64"
)
