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
import { IBM_Plex_Sans, IBM_Plex_Serif, IBM_Plex_Mono } from "next/font/google"

// One designed family across roles: Plex Sans for body and UI, Plex Serif
// for term headwords and the logo, Plex Mono for model names, prompt keys,
// and hashes.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"]
})

const plexSerif = IBM_Plex_Serif({
  variable: "--font-plex-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"]
})

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"]
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
