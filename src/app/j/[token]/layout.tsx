import { Noto_Sans_JP } from "next/font/google";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export default function JimuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={notoSansJP.className}>{children}</div>;
}
