import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AppleCalendar — Discover & Manage Events",
    template: "%s | AppleCalendar",
  },
  description:
    "AppleCalendar is a modern event discovery, management, and ticketing platform. Find events, book tickets, and manage your events all in one place.",
  keywords: [
    "AppleCalendar",
    "events",
    "tickets",
    "event management",
    "event discovery",
    "booking",
    "ticketing",
  ],
  authors: [{ name: "AppleCalendar Team" }],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "AppleCalendar — Discover & Manage Events",
    description:
      "Discover amazing events, book tickets, and manage your events with AppleCalendar.",
    siteName: "AppleCalendar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AppleCalendar — Discover & Manage Events",
    description:
      "Discover amazing events, book tickets, and manage your events with AppleCalendar.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}