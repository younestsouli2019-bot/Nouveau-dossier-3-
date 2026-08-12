import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from 'next-themes'
import { Toaster } from "@/components/ui/sonner"
import Providers from '@/components/providers'

export const metadata: Metadata = {
  title: "Swarm Command Center — Unified Ops, Security & AI Assistant",
  description: "Unified swarm control plane integrating procurement, logistics, payouts, EDR security, Base44 skills, swarm agents, and the Jarvis multimodal assistant. Extra-secure with OIDC, TLS, and default dry-run gates.",
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <Providers>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <Toaster />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  )
}
