/**
 * PDFをページごとにPNG画像（base64）に変換する。
 * Gemini Vision API に送るため。参考: pdf2image + Vision の構成（他プロジェクト）。
 */

import path from "path";
import { pathToFileURL } from "url";

/** 解像度（参考: DPI200 相当。精度と速度のバランス） */
const SCALE = 2;

function getPdfJsBasePath(): string {
  try {
    return path.join(process.cwd(), "node_modules", "pdfjs-dist");
  } catch {
    return "";
  }
}

function buildPdfJsOptions(uint8: Uint8Array, withCmap: boolean): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
  };
  if (withCmap) {
    const basePath = getPdfJsBasePath();
    if (basePath) {
      try {
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

/**
 * PDFを各ページのPNG画像（base64）に変換する。
 * @param buffer PDFバイナリ
 * @param maxPages 最大ページ数（デフォルト10。参考: 通常は最初の数ページに必要情報）
 * @returns 各ページの base64 PNG の配列
 */
export async function renderPdfToPngBase64List(
  buffer: Buffer,
  maxPages: number = 10
): Promise<string[]> {
  const uint8 = new Uint8Array(buffer);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  let loadingTask = pdfjs.getDocument(buildPdfJsOptions(uint8, true) as Parameters<typeof pdfjs.getDocument>[0]);
  let pdfDoc: {
    numPages: number;
    getPage: (i: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<unknown> } }>;
    destroy: () => void;
  };
  try {
    pdfDoc = await loadingTask.promise as typeof pdfDoc;
  } catch (loadErr) {
    const loadMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
    if (process.env.NODE_ENV !== "test") {
      console.warn("[pdfToImages] getDocument with cMap failed:", loadMsg, "- retrying without cMap");
    }
    loadingTask = pdfjs.getDocument(buildPdfJsOptions(uint8, false) as Parameters<typeof pdfjs.getDocument>[0]);
    pdfDoc = await loadingTask.promise as typeof pdfDoc;
  }

  const numPages = Math.min(pdfDoc.numPages, maxPages);
  const list: string[] = [];

  try {
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      const renderTask = page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        canvas: null,
        viewport,
      });
      await renderTask.promise;
      const base64 = canvas.toBuffer("image/png").toString("base64");
      list.push(base64);
    }
  } finally {
    pdfDoc.destroy();
  }

  if (process.env.NODE_ENV !== "test") {
    console.log("[pdfToImages] Rendered", list.length, "pages to PNG (base64)");
  }
  return list;
}
