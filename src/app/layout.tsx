import type { Metadata } from "next";
import "./globals.css";
import { Noto_Sans_JP, Inter } from "next/font/google";

const noto = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

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
    <html lang="ja" className={`${noto.variable} ${inter.variable}`}>
      <body className="bg-white text-[14px] leading-[1.6] text-[#374151]">
        {children}
      </body>
    </html>
  );
}
