import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoDub – YouTube Avtomatik Dublyaj",
  description: "YouTube videolarni o'zbek tiliga bepul dublyaj qiling",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
