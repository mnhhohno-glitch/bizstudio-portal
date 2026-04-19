/**
 * pdfjs-dist でテキストレイヤーを抽出する。
 * システムダウンロードPDFなど、pdf-parse が 0 文字を返す場合のフォールバック用。
 * cMapUrl / standardFontDataUrl を指定し日本語PDFに対応する。
 */

import path from "path";
import { pathToFileURL } from "url";

function getPdfJsBasePath(): string {
  try {
    return path.join(process.cwd(), "node_modules", "pdfjs-dist");
  } catch {
    return "";
  }
}

export type PdfJsExtractResult = { text: string; numPages: number };

export async function extractTextFromPdfWithPdfJs(buffer: Buffer): Promise<string> {
  const r = await extractTextFromPdfWithPdfJsFull(buffer);
  return r.text;
}

function buildPdfJsOptions(
  uint8: Uint8Array,
  withCmap: boolean
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
  };
  if (withCmap) {
    const basePath = getPdfJsBasePath();
    if (basePath) {
      try {
        // 本番(Docker)で pdfjs が要求する「末尾スラッシュ」を確実に付与（URL は / で統一）
        opts.cMapUrl = pathToFileURL(path.join(basePath, "cmaps") + "/").href;
        opts.cMapPacked = true;
        opts.standardFontDataUrl = pathToFileURL(path.join(basePath, "standard_fonts") + "/").href;
      } catch {
        // ignore
      }
    }
  }
  return opts;
}

async function extractWithOptions(
  pdfjs: unknown,
  getDocumentOptions: Record<string, unknown>
): Promise<PdfJsExtractResult> {
  const getDoc = (pdfjs as { getDocument: (opts: unknown) => { promise: Promise<unknown> } }).getDocument;
  const loadingTask = getDoc(getDocumentOptions);
  const pdfDoc = (await loadingTask.promise) as {
    numPages: number;
    getPage: (i: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
    destroy: () => void;
  };
  const numPages = pdfDoc.numPages;
  const textParts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = (textContent.items as { str?: string }[])
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
    textParts.push(pageText);
  }
  pdfDoc.destroy();
  const result = textParts.join("\n\n").trim();
  return { text: result, numPages };
}

/**
 * テキストとページ数を返す。extractText.ts で OCR 要不要の判定に numPages を使う。
 * CMap 指定で 0 文字のときは CMap なしで再試行（本番で file:// CMap が読めない場合のフォールバック）。
 */
export async function extractTextFromPdfWithPdfJsFull(buffer: Buffer): Promise<PdfJsExtractResult> {
  const len = buffer?.length ?? 0;
  if (process.env.NODE_ENV !== "test") {
    console.log("[extractTextPdfJs] Extracting text with pdfjs-dist, buffer size:", len);
  }

  try {
    const uint8 = new Uint8Array(buffer);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    let result = await extractWithOptions(pdfjs, buildPdfJsOptions(uint8, true));
    if (result.text.length === 0 && result.numPages > 0) {
      if (process.env.NODE_ENV !== "test") {
        console.log("[extractTextPdfJs] 0 chars with cMap, retrying without cMap...");
      }
      result = await extractWithOptions(pdfjs, buildPdfJsOptions(uint8, false));
    }

    if (process.env.NODE_ENV !== "test") {
      console.log("[extractTextPdfJs] Done, pages:", result.numPages, "chars:", result.text.length);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extractTextPdfJs] Failed:", msg);
    return { text: "", numPages: 0 };
  }
}
