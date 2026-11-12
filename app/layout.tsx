import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import "./globals.css"
import { Header, HeaderStrip } from "@/components/header"
import { HeaderSwitch } from "@/components/header-switch"
import { FeedbackWidget } from "@/components/feedback-widget"
import { SiteFooter } from "@/components/site-footer"
import { ThemeProvider } from "@/components/theme-provider"
import { TRPCProvider } from "@/trpc/client"
import { Toaster } from "@/components/ui/sonner"
import { getCurrentUser } from "@/lib/current-user"
import { ArrivalHighlight } from "@/components/arrival-highlight"
import { ViewPreferenceProvider } from "@/components/interface-view"
import { INTERFACE_VIEW_COOKIE, parseInterfaceView } from "@/lib/interface-view"
import localFont from "next/font/local"
import { cookies } from "next/headers"
import { Suspense } from "react"

// The interface uses the system Swiss sans stack in globals.css. Keep the
// bundled monospace family for identifiers, prompt keys and source hashes.
const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500" }
  ],
  variable: "--font-plex-mono",
  display: "swap"
})

export const metadata: Metadata = {
  title: SITE_NAME,
  // Reset the verification page's no-referrer policy after client navigation.
  referrer: "strict-origin-when-cross-origin"
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const [user, cookieStore] = await Promise.all([getCurrentUser(), cookies()])
  const initialView = parseInterfaceView(
    cookieStore.get(INTERFACE_VIEW_COOKIE)?.value
  )
  const feedbackIdentity = user
    ? user.name?.trim() || user.email?.trim() || "Signed-in contributor"
    : "Anonymous"

  return (
    <html
      lang="en"
      className="light"
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <body
        suppressHydrationWarning
        className={`${plexMono.variable} min-h-screen antialiased bg-background flex flex-col text-foreground font-sans`}
      >
        <TRPCProvider>
          <ThemeProvider>
            <HeaderSwitch full={<Header />} strip={<HeaderStrip />} />
            {/* overflow-x-clip, not -hidden: clip does not create a scroll
              container, so position:sticky keeps working inside pages */}
            <div className="flex-1 overflow-x-clip">
              <ViewPreferenceProvider initialView={initialView}>
                {children}
              </ViewPreferenceProvider>
              <Suspense fallback={null}>
                <ArrivalHighlight />
              </Suspense>
            </div>
            <HeaderSwitch full={<SiteFooter />} strip={null} />
            <FeedbackWidget identity={feedbackIdentity} />
            <Toaster />
          </ThemeProvider>
        </TRPCProvider>
      </body>
    </html>
  )
}
