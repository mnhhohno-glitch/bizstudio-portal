import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bizstudio Portal",
  description: "社内ポータル",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-white text-slate-900">{children}</body>
    </html>
  );
}
