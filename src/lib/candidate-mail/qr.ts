// T-207: LINE WORKS URL の QRコード画像（PNG）。サーバ専用（qrcode パッケージ）。
// メールでは Resend の attachments に content_id 付きで添付し、HTML の <img src="cid:..."> で本文中に表示する
// （data: URL の直接埋め込みは Gmail で表示されないため使わない）。
// 確認画面のプレビューはブラウザ表示なので data: URL を返してよい。

import QRCode from "qrcode";

// 画像は 240px（表示は templates.ts の QR_DISPLAY_PX=120px）。高精細画面でもぼやけないよう2倍で作る。margin（余白）は読み取りのため削らない
const QR_WIDTH_PX = 240;

export async function buildQrPngBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", width: QR_WIDTH_PX, margin: 1, errorCorrectionLevel: "M" });
}

export async function buildQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { type: "image/png", width: QR_WIDTH_PX, margin: 1, errorCorrectionLevel: "M" });
}
