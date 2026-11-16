import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Cairn",
  description: "Notes en Markdown et coffre de mots de passe et de clés, auto-hébergés.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Cairn", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efede8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
