import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import "./globals.css"
import { Header, HeaderStrip } from "@/components/header"
import { HeaderSwitch } from "@/components/header-switch"
import { FeedbackWidget } from "@/components/feedback-widget"
import { ThemeProvider } from "@/components/theme-provider"
import { TRPCProvider } from "@/trpc/client"
import { Toaster } from "@/components/ui/sonner"
import { getCurrentUser } from "@/lib/current-user"
import localFont from "next/font/local"

// One designed family across roles: Plex Sans for body and UI, Plex Serif
// for term headwords and the logo, Plex Mono for model names, prompt keys,
// and hashes. Bundle the licensed files so release builds do not fetch fonts.
const plexSans = localFont({
  src: [
    { path: "./fonts/IBMPlexSans-Regular.woff2", weight: "400" },
    { path: "./fonts/IBMPlexSans-Medium.woff2", weight: "500" },
    { path: "./fonts/IBMPlexSans-SemiBold.woff2", weight: "600" },
    { path: "./fonts/IBMPlexSans-Bold.woff2", weight: "700" }
  ],
  variable: "--font-plex-sans",
  display: "swap"
})

const plexSerif = localFont({
  src: [
    { path: "./fonts/IBMPlexSerif-Medium.woff2", weight: "500" },
    { path: "./fonts/IBMPlexSerif-SemiBold.woff2", weight: "600" },
    { path: "./fonts/IBMPlexSerif-Bold.woff2", weight: "700" }
  ],
  variable: "--font-plex-serif",
  display: "swap",
  adjustFontFallback: "Times New Roman"
})

const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500" }
  ],
  variable: "--font-plex-mono",
  display: "swap"
})

export const metadata: Metadata = {
  title: SITE_NAME
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const user = await getCurrentUser()
  const feedbackIdentity = user
    ? user.name?.trim() || user.email?.trim() || "Signed-in contributor"
    : "Anonymous"

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable} min-h-screen antialiased bg-background flex flex-col text-foreground font-sans`}
      >
        <TRPCProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <HeaderSwitch full={<Header />} strip={<HeaderStrip />} />
            {/* overflow-x-clip, not -hidden: clip does not create a scroll
              container, so position:sticky keeps working inside pages */}
            <div className="flex-1 overflow-x-clip">{children}</div>
            <FeedbackWidget identity={feedbackIdentity} />
            <Toaster />
          </ThemeProvider>
        </TRPCProvider>
      </body>
    </html>
  )
}
