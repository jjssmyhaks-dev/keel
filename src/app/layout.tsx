import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
});
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

const appUrl = process.env.APP_URL || "http://localhost:3000";

// Runs before first paint so a saved theme applies without a flash.
const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )authab_theme=([^;]+)/);var t=m?decodeURIComponent(m[1]):"";if(t&&/^(default|forest|bee|mint|parchment)$/.test(t)){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Authab — Identity for AI agents",
    template: "%s · Authab",
  },
  description:
    "Authab gives every AI agent an identity, a vault and a boundary. Short-lived tokens, proxy-injected credentials, approvals and a tamper-evident audit trail.",
  keywords: ["AI agents", "agent identity", "credential vault", "agent authentication", "AI governance"],
  openGraph: {
    title: "Authab — Identity for AI agents",
    description:
      "Identity, vault and governance for AI agents. Go from sign-up to an authenticated agent call in under five minutes.",
    type: "website",
    url: appUrl,
    siteName: "Authab",
  },
  twitter: { card: "summary_large_image", title: "Authab — Identity for AI agents" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
