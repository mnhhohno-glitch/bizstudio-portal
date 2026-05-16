/**
 * RPA(PAD) からのリクエストボディを堅牢にパースする。
 *
 * PAD(Power Automate Desktop) は HTTP アクションで JSON ボディを送る際、
 * ボディ全体を URL エンコードした文字列として送信してくる（例: `%7b+%22batchId%22...`）。
 * そのため通常の `req.json()` は `Unexpected token '%'` で失敗する。
 *
 * フォールバック順:
 *   1) 素の JSON
 *   2) URL エンコードされた JSON（PAD の標準挙動）
 *   3) form-urlencoded (key=value&...)
 *   4) URL クエリパラメータ
 */
export async function parseRpaRequestBody(
  req: Request,
): Promise<Record<string, unknown>> {
  const url = new URL(req.url);

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    raw = "";
  }

  const tryJson = (s: string): Record<string, unknown> | null => {
    const t = s.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  // 1) 素の JSON
  let body = tryJson(raw);

  // 2) URL エンコードされた JSON（PAD はこの形式で送ってくる）
  //    `+` は区切りの空白を意味するため、デコード前に空白へ戻す。
  if (!body && raw) {
    try {
      body = tryJson(decodeURIComponent(raw.replace(/\+/g, " ")));
    } catch {
      // decodeURIComponent 失敗は無視してフォールバックを継続
    }
  }

  // 3) form-urlencoded (key=value&...)
  if (!body && raw && raw.includes("=")) {
    const params = new URLSearchParams(raw);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of params) obj[k] = v;
    if (Object.keys(obj).length > 0) body = obj;
  }

  // 4) URL クエリパラメータをマージ（ボディに無いキーのみ補完）
  if (!body) body = {};
  for (const [k, v] of url.searchParams) {
    if (body[k] === undefined) body[k] = v;
  }

  return body;
}
