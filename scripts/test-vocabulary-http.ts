// Run after a production build and test:canonical-db with W3ID_KEEP_FIXTURE=true
// against a disposable database. Exercise the real Next server, including the
// HTTPS forwarding headers used by Nginx, rather than just calling handlers.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { once } from "node:events"
import { SITE_URL, IDENTIFIER_BASE_URL } from "../lib/site"

async function main() {
  const { scopes } = JSON.parse(readFileSync("/tmp/w3id-fixture.json", "utf8"))
  const reservation = createServer().listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const address = reservation.address()
  assert.ok(address && typeof address !== "string")
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const base = `http://127.0.0.1:${address.port}`
  const server = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1",
    "--port", String(address.port)
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SESSION_PASSWORD: randomBytes(32).toString("hex") }
  })
  let output = ""
  server.stdout.on("data", (data) => { output += data })
  server.stderr.on("data", (data) => { output += data })
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(server.exitCode, null, "Next server exited before readiness")
      try {
        ready = (await fetch(base + "/api/health", {
          signal: AbortSignal.timeout(1000)
        })).ok
      } catch { /* wait for the listener */ }
      if (ready) break
      await delay(100)
    }
    assert.ok(ready, "Next server did not become ready")
    const term = `/vocabulary/${scopes[0]}/metal`
    for (const forwarded of [false, true]) {
      const headers: Record<string, string> = forwarded ? {
        Host: "sam.example", "X-Forwarded-Host": "sam.example",
        "X-Forwarded-Proto": "https", "X-Forwarded-Port": "443"
      } : {}
      const read = (path: string, accept = "text/html", method = "GET") =>
        fetch(base + path, {
          headers: { ...headers, Accept: accept }, method,
          redirect: "manual", signal: AbortSignal.timeout(15000)
        })
      for (const resource of [
        "/vocabulary", `/vocabulary/${scopes[0]}`, term,
        term + "/definitions/2", term + "/definitions/1/revisions/1"
      ]) {
        for (const format of ["ttl", "jsonld"]) {
          const suffix = `/skos.${format}`
          const response = await read(resource + suffix)
          assert.equal(response.status, 200, `${forwarded}: ${resource}${suffix}`)
          assert.ok(response.headers.get("content-type")?.includes(
            format === "ttl" ? "text/turtle" : "application/ld+json"
          ))
          assert.equal(response.headers.get("cache-control"), "no-store")
          if (resource === term && format === "jsonld") {
            const graph = await response.json()
            const concept = graph.find((node: Record<string, unknown>) =>
              node["@id"] === IDENTIFIER_BASE_URL + term)
            assert.equal(concept[IDENTIFIER_BASE_URL + "/metadata#canonicalDefinition"][0]["@id"],
              IDENTIFIER_BASE_URL + term + "/definitions/2")
          } else await response.arrayBuffer()
        }
      }
      for (const format of ["ttl", "jsonld"]) {
        const response = await read(term + `/provenance.${format}`)
        assert.equal(response.status, 200, "readable provenance document")
        assert.ok((await response.text()).includes(IDENTIFIER_BASE_URL + term))
      }
      const head = await read(term + "/skos.jsonld", "application/ld+json", "HEAD")
      assert.equal(head.status, 200)
      assert.equal(await head.text(), "")
      for (const [accept, format] of [["text/turtle", "ttl"], ["application/ld+json", "jsonld"]]) {
        const response = await read(term, accept)
        assert.equal(response.status, 303)
        assert.equal(response.headers.get("location"), SITE_URL + term + `/skos.${format}`)
        assert.match(response.headers.get("vary") ?? "", /Accept/i)
        assert.equal(response.headers.get("cache-control"), "no-store")
      }
      // Query parameters cannot turn a published document into another resource
      // or representation; its path determines the response.
      const overridden = await read(term + "/skos.jsonld?resource=/bad&format=ttl&provenance=true")
      assert.equal(overridden.status, 200)
      const graph = await overridden.json()
      assert.ok(graph.some((node: Record<string, unknown>) => node["@id"] === IDENTIFIER_BASE_URL + term))
      const invalid = await read(term + "/extra/skos.jsonld")
      assert.equal(invalid.status, 404)
      await invalid.arrayBuffer()
      const html = await read(term)
      assert.equal(html.status, 200)
      assert.ok((await html.text()).includes("Canonical definition"))
    }
    console.log("Production vocabulary HTTP checks passed directly and behind HTTPS forwarding")
  } catch (error) {
    console.error(output)
    throw error
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "exit")
      server.kill("SIGTERM")
      await stopped
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
