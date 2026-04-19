/**
 * PDFをページごとに画像化し、Tesseract.jsで日本語OCRする。
 * テキスト抽出が0文字のときのフォールバック用。Node環境のみ。
 * cMapUrl/standardFontDataUrl を指定し、日本語PDFのフォント描画エラーを軽減する。
 * getDocument が失敗した場合（例: Invalid factory url）は CMap なしで再試行する。
 */

import path from "path";
import { pathToFileURL } from "url";

const SCALE = 2; // 解像度（OCR精度のため2推奨）

function getPdfJsBasePath(): string {
  try {
    return path.join(process.cwd(), "node_modules", "pdfjs-dist");
  } catch {
    return "";
  }
}

function buildOcrPdfJsOptions(uint8: Uint8Array, withCmap: boolean): Record<string, unknown> {
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
        // パス解決に失敗した場合はオプションなしで続行
      }
    }
  }
  return opts;
}

export async function extractTextFromPdfWithOcr(buffer: Buffer): Promise<string> {
  const len = buffer?.length ?? 0;
  if (process.env.NODE_ENV !== "test") {
    console.log("[extractTextPdfOcr] Starting OCR fallback, buffer size:", len);
  }

  try {
    const uint8 = new Uint8Array(buffer);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    const { createWorker } = await import("tesseract.js");

    let loadingTask = pdfjs.getDocument(buildOcrPdfJsOptions(uint8, true) as Parameters<typeof pdfjs.getDocument>[0]);
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
        console.warn("[extractTextPdfOcr] getDocument with cMap failed:", loadMsg, "- retrying without cMap");
      }
      loadingTask = pdfjs.getDocument(buildOcrPdfJsOptions(uint8, false) as Parameters<typeof pdfjs.getDocument>[0]);
      pdfDoc = await loadingTask.promise as typeof pdfDoc;
    }
    const numPages = pdfDoc.numPages;
    const textParts: string[] = [];

    const worker = await createWorker("jpn", 1, {
      langPath: path.join(process.cwd(), "public", "ai"),
      logger: () => {},
    });

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
        const imageBuffer = canvas.toBuffer("image/png");
        const {
          data: { text },
        } = await worker.recognize(imageBuffer);
        textParts.push(text?.trim() ?? "");
      }
    } finally {
      await worker.terminate();
    }
    pdfDoc.destroy();

    const result = textParts.join("\n\n").trim();
    if (process.env.NODE_ENV !== "test") {
      console.log("[extractTextPdfOcr] OCR done, pages:", numPages, "chars:", result.length);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extractTextPdfOcr] OCR failed:", msg);
    return "";
  }
}
