import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "書類のご確認 | 株式会社ビズスタジオ",
  description: "パスワードを入力して書類をご確認ください",
  openGraph: {
    title: "書類のご確認",
    description: "パスワードを入力して書類をご確認ください",
    siteName: "株式会社ビズスタジオ",
  },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
