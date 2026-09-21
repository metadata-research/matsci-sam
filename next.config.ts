import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Keep local verification predictable on shared workstations.
  experimental: { cpus: 2, webpackMemoryOptimizations: true },
  async rewrites() {
    return {
      beforeFiles: ["skos", "provenance"].map((document) => ({
        source: `/vocabulary/:path*/${document}.:format(ttl|jsonld)`,
        destination: `/api/vocabulary-document/${document}/:format/vocabulary/:path*`
      }))
    }
  }
}

export default nextConfig
