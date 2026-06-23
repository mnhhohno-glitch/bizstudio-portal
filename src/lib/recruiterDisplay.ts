/**
 * 担当RC（スカウト配信者）表示専用フォーマッタ
 *
 * ⚠️⚠️⚠️ 表示専用（VIEW-ONLY）。⚠️⚠️⚠️
 * 「RPA ●号機」表記 / 配信担当の実名を、画面表示するときだけ整形するためのヘルパ。
 *
 * 戻り値を以下に使ってはならない（DB上の値＝号機表記/実名のまま扱うこと）:
 *   - DB保存 / 更新の値（recruiterName / machineId 等への書き込み）
 *   - API リクエスト / レスポンスのデータ本体
 *   - 集計・突合・グルーピングキー / マスタ照合（ScoutMachineMaster の aliases 等）
 *
 * recruiterName / machineId の号機表記は配信実績の自動集計・配信枠突合の
 * キーとして現役で使われている。値を書き換えると集計が壊れる。
 * このフォーマッタは「画面に出す瞬間」だけ通すこと。
 */

// 全角数字→半角
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/**
 * 検索・突合の比較用正規化（全角数字→半角・空白除去）。
 *
 * これは「比較キーの正規化」であり、`formatRecruiterName` の戻り値（VIEW専用）とは
 * 用途が異なる。担当RC の絞り込みで「入力された実担当者名」と「号機→実名変換後の表示値」を
 * 表記揺れ込みで突合するために両辺へ通す。DB保存・集計グルーピングキーには使わない。
 */
export function normalizeRecruiterName(value: string | null | undefined): string {
  if (value == null) return "";
  return toHalfWidthDigits(value).replace(/[\s　]+/g, "");
}

// 配信担当の正準名簿（対応表は本配列の1か所に集約）。
// ⚠️ 実名は full name で一意に判定する。藤本 なつみ(1号機) と 藤本 夏海(一斉配信)、
//    大野 望(一斉配信) と 大野 将幸(実名のみ・名簿外) を取り違えない。
// machineNo!=null → 号機担当（下段 "(RPA○号機)"）／null → 一斉配信担当（下段 "(一斉配信)"）。
const RC_ROSTER: { name: string; unit: string; machineNo: number | null }[] = [
  { name: "藤本 なつみ", unit: "(RPA1号機)", machineNo: 1 },
  { name: "岡田 かなこ", unit: "(RPA2号機)", machineNo: 2 },
  { name: "上原 ちはる", unit: "(RPA3号機)", machineNo: 3 },
  { name: "上原 千遥", unit: "(RPA4号機)", machineNo: 4 },
  { name: "岡田 愛子", unit: "(RPA5号機)", machineNo: 5 },
  { name: "安藤 嘉富", unit: "(RPA6号機)", machineNo: 6 },
  { name: "大野 望", unit: "(一斉配信)", machineNo: null },
  { name: "藤本 夏海", unit: "(一斉配信)", machineNo: null },
];

// 号機番号 → 実名（号機表記入力の変換用）
const MACHINE_NUMBER_TO_REAL_NAME: Record<string, string> = Object.fromEntries(
  RC_ROSTER.filter((r) => r.machineNo != null).map((r) => [String(r.machineNo), r.name]),
);

// 正規化実名（空白除去）→ 表示用 { name, unit }（実名直挿しレコードの2段化用）
const NORMALIZED_NAME_TO_DISPLAY = new Map<string, { name: string; unit: string }>(
  RC_ROSTER.map((r) => [normalizeRecruiterName(r.name), { name: r.name, unit: r.unit }]),
);

// 表示値（末尾ユニット）の分割パターン: (RPA○号機) または (一斉配信)
const UNIT_SUFFIX_RE = /^(.*?)\s*(\((?:RPA[1-6]号機|一斉配信)\))$/;

/**
 * 「●号機」表記を「実名(RPA○号機)」へ変換して返す（表示専用）。
 * 号機表記が含まれなければ入力をそのまま返す（実名直挿し・一斉配信担当はここでは変換しない）。
 *
 * ※ソート/絞り込みはこの戻り値を比較キーに使う。挙動は従来どおり（現状維持）。
 * 実名直挿し→2段化・一斉配信下段付与は表示専用の `splitRecruiterDisplay` 側で行う。
 *
 * 揺れ吸収: 接頭辞「RPA」の有無 / 半角全角数字 / スペース揺れ。
 */
export function formatRecruiterName(value: string | null | undefined): string {
  if (value == null) return value ?? "";
  const original = value;
  // 正規化: 全角数字→半角, 半角/全角スペース除去（normalizeRecruiterName に集約）
  const normalized = normalizeRecruiterName(original);
  const match = normalized.match(/([1-6])号機/);
  if (!match) return original;
  const realName = MACHINE_NUMBER_TO_REAL_NAME[match[1]];
  return realName ? `${realName}(RPA${match[1]}号機)` : original;
}

/**
 * 担当RCの2段表示用の分割ヘルパー（表示専用・T-104追補 / 追補2）。
 *
 * 名簿（RC_ROSTER）を1か所のソースとして、以下を全て2段（{ name, unit }）に分離して返す:
 *  - 号機表記 "RPA N号機"（formatRecruiterName で "実名(RPA○号機)" 化済み）
 *  - 号機担当の実名直挿し（"藤本なつみ"/"上原千遥" 等。表記揺れは normalizeRecruiterName で吸収）
 *  - 一斉配信担当（"大野 望"/"藤本 夏海" → 下段 "(一斉配信)"）
 * 名簿外の実名（小野 有加・大野 将幸 等）は1段（unit=null）。空(NULL/空文字/"-") は "-"。
 *
 * ⚠️ 表示専用。ソート/絞り込み/集計/突合は引き続き DB値 / `formatRecruiterName` /
 * `normalizeRecruiterName` を使うこと（本ヘルパーの戻り値は画面描画専用）。
 */
export function splitRecruiterDisplay(value: string | null | undefined): { name: string; unit: string | null } {
  const formatted = formatRecruiterName(value);
  if (!formatted || formatted === "-") return { name: "-", unit: null };
  // 1) 既に「実名(RPA○号機)」へ変換済み（号機表記入力）→ 末尾ユニットで分割
  const m = formatted.match(UNIT_SUFFIX_RE);
  if (m) return { name: m[1].trim(), unit: m[2] };
  // 2) 実名直挿し（号機担当 or 一斉配信担当）→ 正準名簿引きで2段化
  const disp = NORMALIZED_NAME_TO_DISPLAY.get(normalizeRecruiterName(formatted));
  if (disp) return { name: disp.name, unit: disp.unit };
  // 3) 名簿外の実名・その他は1段
  return { name: formatted, unit: null };
}
