import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
import { ThemeProvider } from 'next-themes'
import { Toaster } from "@/components/ui/sonner"
import Providers from '@/components/providers'

export const metadata: Metadata = {
  title: "Supply Chain Management — Procurement, Shipments & Payments",
  description: "Comprehensive supply chain management with procurement tracking, shipment verification, and owner payment routing.",
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.className} ${GeistMono.className} antialiased bg-background text-foreground`}>
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
