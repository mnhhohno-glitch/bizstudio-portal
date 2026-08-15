// T-147: メール本文の組み立て検証（2026-08-06 改修分）。
// 実送信で使う関数そのものを呼んで文面を確認する。ネットワーク・DB は使わない。
//
// 実行: npx tsx scripts/verify_t147_mailbody.ts
//
// 確認する仕様:
//   - 本文の初期値に固定の挨拶文（ご担当者様 / 株式会社ビズスタジオよりファイルを…）が入らない
//   - 案内文（下記URLを開き…）が本文の直後・■ダウンロードURL の直前に来る
//   - パスワード「記載しない」時は案内文からパスワードへの言及が外れ、■パスワード 欄も消える
//   - 送信控えに平文パスワードが含まれない

import {
  buildDefaultTransferBodyIntro,
  buildTransferNoticeBody,
  buildTransferSignature,
} from "@/lib/secure-transfer-shared";
import { buildTransferCopyBody } from "@/lib/secure-transfer-mail";

const EXPIRES = new Date("2026-09-05T14:59:59.999Z"); // JST 2026/09/05 23:59
const SENT_AT = new Date("2026-08-06T01:00:00.000Z");
const URL = "https://example.invalid/transfer/TOKEN";
const REAL_PASSWORD = "Kx7mQp2rTb9n"; // 控えに絶対に出てはいけない値
const FILES = ["契約書.pdf"];
const SIGNATURE = buildTransferSignature("大野 将幸", "masayuki_oono@bizstudio.co.jp");

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) pass++;
  else fail++;
  console.log(`[${ok ? "OK" : "NG"}] ${id}  ${detail}`);
}

// ---------------------------------------------------------------- 初期値
const emptyInit = buildDefaultTransferBodyIntro("");
const withMemo = buildDefaultTransferBodyIntro("お世話になっております。資料をお送りします。");
check(
  "M-1 本文の初期値は空",
  emptyInit === "",
  `添え書きなし -> ${JSON.stringify(emptyInit)}`
);
check(
  "M-2 添え書きがあればそれのみが初期値",
  withMemo === "お世話になっております。資料をお送りします。",
  `-> ${JSON.stringify(withMemo)}`
);
check(
  "M-3 固定の挨拶文が廃止されている",
  !emptyInit.includes("ご担当者様") &&
    !withMemo.includes("ご担当者様") &&
    !withMemo.includes("株式会社ビズスタジオよりファイルをお送りいたします"),
  "「ご担当者様」「株式会社ビズスタジオより…」を含まない"
);

// ---------------------------------------------------------------- パスワード記載あり
const bodyWithPw = buildTransferNoticeBody({
  body: "お世話になっております。資料をお送りします。",
  signature: SIGNATURE,
  url: URL,
  password: REAL_PASSWORD,
  passwordInEmail: true,
  expiresAt: EXPIRES,
  fileNames: FILES,
});
const iMemo = bodyWithPw.indexOf("資料をお送りします。");
const iLead = bodyWithPw.indexOf("下記URLを開き、パスワードを入力のうえ");
const iUrlHead = bodyWithPw.indexOf("■ダウンロードURL");
check(
  "M-4 本文 → 案内文 → ■ダウンロードURL の順",
  iMemo >= 0 && iLead > iMemo && iUrlHead > iLead,
  `本文=${iMemo} 案内文=${iLead} URL見出し=${iUrlHead}`
);
check(
  "M-5 パスワード記載ありでは ■パスワード 欄が出る",
  bodyWithPw.includes("■パスワード") && bodyWithPw.includes(REAL_PASSWORD),
  "■パスワード 欄とパスワード本体を含む"
);

// ---------------------------------------------------------------- パスワード記載なし
const bodyNoPw = buildTransferNoticeBody({
  body: "",
  signature: SIGNATURE,
  url: URL,
  password: REAL_PASSWORD,
  passwordInEmail: false,
  expiresAt: EXPIRES,
  fileNames: FILES,
});
check(
  "M-6 記載しない時は案内文からパスワードへの言及が外れる",
  bodyNoPw.includes("下記URLを開き、有効期限までにダウンロードをお願いいたします。") &&
    bodyNoPw.includes("パスワードは送信者より別途お伝えします。") &&
    !bodyNoPw.includes("パスワードを入力のうえ"),
  "「別途お伝えします」の文面に差し替わる"
);
check(
  "M-7 記載しない時は ■パスワード 欄もパスワード本体も出ない",
  !bodyNoPw.includes("■パスワード") && !bodyNoPw.includes(REAL_PASSWORD),
  "■パスワード 欄なし・平文なし"
);
check(
  "M-8 本文が空でも先頭が案内文になり崩れない",
  bodyNoPw.startsWith("下記URLを開き、"),
  `先頭 = ${JSON.stringify(bodyNoPw.slice(0, 24))}`
);

// ---------------------------------------------------------------- 送信控え
const copy = buildTransferCopyBody({
  senderName: "大野 将幸",
  recipientEmails: ["masayuki_oono@bizstudio.co.jp"],
  ccEmails: ["masayuki_oono@bizstudio.co.jp"],
  sentAt: SENT_AT,
  url: URL,
  passwordInEmail: true,
  expiresAt: EXPIRES,
  fileNames: FILES,
  subject: "ご契約書類の送付",
  body: "お世話になっております。資料をお送りします。",
  signature: SIGNATURE,
});
check(
  "M-9 控えに平文パスワードが含まれない",
  !copy.includes(REAL_PASSWORD),
  `REAL_PASSWORD の出現 = ${copy.includes(REAL_PASSWORD) ? "あり(NG)" : "なし"}`
);
check(
  "M-10 控えに 送信日時/宛先/CC/有効期限/ファイル/URL/本文全文 が含まれる",
  copy.includes("■送信日時:") &&
    copy.includes("■宛先(TO): masayuki_oono@bizstudio.co.jp") &&
    copy.includes("■CC: masayuki_oono@bizstudio.co.jp") &&
    copy.includes("■有効期限:") &&
    copy.includes("契約書.pdf") &&
    copy.includes(URL) &&
    copy.includes("【実際に送信したメール本文】") &&
    copy.includes("資料をお送りします。"),
  "必要項目をすべて含む"
);
check(
  "M-11 控えであることが冒頭で分かる",
  copy.includes("これは送信者控えです。"),
  "冒頭に控えである旨の一文がある"
);

const copyNoCc = buildTransferCopyBody({
  senderName: "大野 将幸",
  recipientEmails: ["masayuki_oono@bizstudio.co.jp"],
  ccEmails: [],
  sentAt: SENT_AT,
  url: URL,
  passwordInEmail: false,
  expiresAt: EXPIRES,
  fileNames: FILES,
  subject: "ご契約書類の送付",
  body: "",
  signature: SIGNATURE,
});
check(
  "M-12 CCなし・パスワード非記載でも控えが崩れない",
  copyNoCc.includes("■CC: （なし）") && !copyNoCc.includes(REAL_PASSWORD),
  "CC は「（なし）」表記・平文パスワードなし"
);

console.log(`\n--- 結果: ${pass} OK / ${fail} NG ---`);
if (process.argv.includes("--print")) {
  console.log("\n========== 受信者向け（パスワード記載あり） ==========\n" + bodyWithPw);
  console.log("\n========== 受信者向け（パスワード記載なし・本文空） ==========\n" + bodyNoPw);
  console.log("\n========== 送信控え ==========\n" + copy);
}
if (fail > 0) process.exit(1);
