import type { Metadata } from "next";
import "./globals.css";
import "@fontsource-variable/noto-sans-jp";
import "@fontsource-variable/inter";

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
      <body className="bg-white text-[14px] leading-[1.6] text-[#374151]">
        {children}
      </body>
    </html>
  );
}
