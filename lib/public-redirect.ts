// Relative Locations retain the browser-visible public origin behind a proxy.
// Never construct public redirects from Next's internal request.url origin.
export function publicRedirect(path: string, status: 303 | 307 | 308 = 307) {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path))
    throw new Error("Expected an application path")
  return new Response(null, {
    status,
    headers: { Location: path, "Cache-Control": "no-store" }
  })
}
