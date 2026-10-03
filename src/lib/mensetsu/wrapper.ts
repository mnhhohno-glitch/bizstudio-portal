// T-206: 公開ページに付ける共通ヘッダー・フッター・検索除け。プレビューと外部 API（配信）で同じ関数を使う。
//   - <head> に robots noindex / referrer no-referrer
//   - <body> 直後にヘッダー（株式会社ビズスタジオ／{氏名}様 専用ページ）、</body> 直前にフッター
//   - 資料側の CSS に影響されにくいよう、クラス名に接頭辞（bzs-）を付け、スタイルは要素に直接指定
//   - <head>／<body> が無い HTML は最小限の骨組みで包む

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const WRAPPER_HEAD_TAGS =
  `<meta name="robots" content="noindex, nofollow, noarchive">` +
  `<meta name="referrer" content="no-referrer">`;

const FONT = `font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif`;

export function buildWrapperHeader(candidateName: string): string {
  const name = escapeHtml(candidateName.trim());
  return (
    `<div class="bzs-wrap-header" style="all:initial;display:block;box-sizing:border-box;width:100%;margin:0;padding:10px 16px;` +
    `background:#ffffff;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;line-height:1.5;${FONT};">` +
    `<span class="bzs-wrap-company" style="font-weight:600;">株式会社ビズスタジオ</span>` +
    `<span class="bzs-wrap-sep" style="margin:0 6px;color:#9ca3af;">／</span>` +
    `<span class="bzs-wrap-name">${name}様 専用ページ</span>` +
    `</div>`
  );
}

export function buildWrapperFooter(): string {
  return (
    `<div class="bzs-wrap-footer" style="all:initial;display:block;box-sizing:border-box;width:100%;margin:0;padding:14px 16px 18px;` +
    `background:#ffffff;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px;line-height:1.6;text-align:center;${FONT};">` +
    `この資料は閲覧者ご本人のために作成したものです。第三者への転送・共有はお控えください。` +
    `<br><span class="bzs-wrap-copy" style="color:#9ca3af;">株式会社ビズスタジオ</span>` +
    `</div>`
  );
}

const HEAD_OPEN = /<head\b[^>]*>/i;
const BODY_OPEN = /<body\b[^>]*>/i;
const BODY_CLOSE = /<\/body\s*>/i;

/**
 * 資料 HTML に共通ヘッダー・フッター・検索除けを入れた最終形を返す。
 * useWrapper=false の記録は呼ばずに html をそのまま配る。
 */
export function wrapMensetsuHtml(html: string, opts: { candidateName: string }): string {
  const header = buildWrapperHeader(opts.candidateName);
  const footer = buildWrapperFooter();

  const hasHead = HEAD_OPEN.test(html);
  const hasBody = BODY_OPEN.test(html);

  if (!hasHead || !hasBody) {
    // 骨組みが無い（断片 HTML）→ 最小限の骨組みで包む
    return (
      `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n${WRAPPER_HEAD_TAGS}\n</head>\n<body>\n` +
      `${header}\n${html}\n${footer}\n</body>\n</html>\n`
    );
  }

  let out = html.replace(HEAD_OPEN, (m) => `${m}\n${WRAPPER_HEAD_TAGS}`);
  out = out.replace(BODY_OPEN, (m) => `${m}\n${header}`);
  if (BODY_CLOSE.test(out)) {
    out = out.replace(BODY_CLOSE, (m) => `${footer}\n${m}`);
  } else {
    out = `${out}\n${footer}`;
  }
  return out;
}
