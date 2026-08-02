// T-147: 社外の受信者が開くダウンロードページのレイアウト（認証不要・(app) の外）。

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ファイルのお受け取り | 株式会社ビズスタジオ",
  description: "パスワードを入力してファイルをダウンロードしてください",
  openGraph: {
    title: "ファイルのお受け取り",
    description: "パスワードを入力してファイルをダウンロードしてください",
    siteName: "株式会社ビズスタジオ",
  },
};

export default function TransferLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
