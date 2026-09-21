/** Bound the body while streaming, before decoding or parsing upstream data. */
export async function readReferenceBody(
  response: Response,
  maxBytes = 128 * 1024
) {
  if (!response.body) throw new Error("Empty provider response")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes)
        throw new Error("Provider response exceeds the size limit")
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks).toString("utf8")
}
