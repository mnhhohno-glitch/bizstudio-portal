import ExcelJS from "exceljs";

/** テキスト抽出がこの文字数未満かつページがある場合、OCRフォールバックを試す */
const MIN_TEXT_LENGTH_BEFORE_OCR = 20;

/**
 * PDFのBufferからテキストを抽出（Nodeのみ）。
 * 1) pdf-parse でテキストレイヤー取得
 * 2) 0文字または極端に短い場合、pdfjs-dist でテキスト抽出を再試行（システムDL PDFなどで有効）
 * 3) まだ短い場合は OCR フォールバック
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const len = buffer?.length ?? 0;
  try {
    let text = "";
    let numpages = 0;

    // 1) pdf-parse
    try {
      const mod = await import("pdf-parse");
      const pdfParse = (mod as { default?: (b: Buffer) => Promise<{ text?: string; numpages?: number }> }).default ?? mod;
      const data = await (pdfParse as (b: Buffer) => Promise<{ text?: string; numpages?: number }>)(buffer);
      text = typeof data?.text === "string" ? data.text.trim() : "";
      numpages = typeof data?.numpages === "number" ? data.numpages : 0;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      if (process.env.NODE_ENV !== "test") {
        console.warn("[extractText] pdf-parse failed:", msg);
      }
    }

    if (process.env.NODE_ENV !== "test") {
      console.log(`[extractText] PDF: buffer=${len} bytes, pages=${numpages}, pdf-parse extracted=${text.length} chars`);
    }

    // 2) 短い場合に pdfjs-dist でテキスト抽出を試行（システムDL PDF 等で有効）
    if (text.length < MIN_TEXT_LENGTH_BEFORE_OCR && len > 0) {
      if (process.env.NODE_ENV !== "test") {
        console.log("[extractText] Trying pdfjs-dist text extraction fallback...");
      }
      const { extractTextFromPdfWithPdfJsFull } = await import("./extract-text-pdfjs");
      const pdfJsResult = await extractTextFromPdfWithPdfJsFull(buffer);
      if (pdfJsResult.text.length > text.length) {
        text = pdfJsResult.text;
        if (process.env.NODE_ENV !== "test") {
          console.log("[extractText] pdfjs-dist fallback succeeded, chars:", text.length);
        }
      }
      if (pdfJsResult.numPages > 0 && numpages === 0) {
        numpages = pdfJsResult.numPages;
      }
    }

    // 3) OCR フォールバック — 無効化中（jpn.traineddata 未配置でプロセスがハングするため）
    //    将来 traineddata を配置した際にコメントを外して復活可能
    // if (text.length < MIN_TEXT_LENGTH_BEFORE_OCR && len > 0) {
    //   if (process.env.NODE_ENV !== "test") {
    //     console.log("[extractText] Text still short, trying OCR fallback...");
    //   }
    //   const { extractTextFromPdfWithOcr } = await import("./extract-text-pdf-ocr");
    //   const ocrText = await extractTextFromPdfWithOcr(buffer);
    //   if (ocrText.length > text.length) {
    //     text = ocrText;
    //     if (process.env.NODE_ENV !== "test") {
    //       console.log("[extractText] OCR fallback succeeded, chars:", text.length);
    //     }
    //   } else if (text.length === 0 && process.env.NODE_ENV !== "test") {
    //     console.warn(
    //       "[extractText] PDF returned 0 characters; pdfjs and OCR did not add text. PDF may be image-only (scanned)."
    //     );
    //   }
    // }
    if (text.length < MIN_TEXT_LENGTH_BEFORE_OCR && len > 0 && process.env.NODE_ENV !== "test") {
      console.warn("[extractText] PDF text extraction yielded < 20 chars (OCR disabled). PDF may be image-only.");
    }

    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extractText] PDF extraction failed. buffer=", len, "bytes, error:", msg);
    return "";
  }
}

/**
 * xlsxのBufferからテキストを生成。
 * 正本プロンプトに従い、シート名「リスト」があればそれを優先、なければ1シート目。
 */
export async function extractTextFromXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const listSheet = workbook.getWorksheet("リスト");
  const sheet = listSheet ?? workbook.worksheets[0];
  if (!sheet) return "";

  const rows: string[] = [];
  sheet.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = cell.value;
      let s = "";
      if (val !== null && val !== undefined) {
        if (typeof val === "object" && "text" in val) {
          s = String((val as { text: string }).text);
        } else {
          s = String(val);
        }
      }
      cells.push(s);
    });
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}
