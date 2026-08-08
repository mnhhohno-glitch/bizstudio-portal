// 志向パネル step1: 保存済みタイプ診断（advisor_chat_messages.content）の Markdown 全文から、
// job-platform の「求職者選択モード」に出す志向要約3ブロックを切り出す。
//
// **AI を一切呼ばない純粋関数**（保存済みテキストの文字列処理のみ）。費用ゼロ。
// 診断の生成側（AdvisorFloatingPanel / advisor chat route / SKILL）には一切触れない。
//
// フェイルクローズ設計:
//   見出しが見つからないブロックは null を返す。「見出しが無いから全文を返す」ことは絶対にしない。
//   → 隣接セクション（提案時の注意点 / 書類作成のポイント 等）の本文が混入する経路を構造的に断つ。
//   既存 comment-split.ts の extractCandidateFacingComment は「見出しが無い場合に以降の全文を返す」
//   漏洩バグが既知として残っているが、本モジュールはその挙動を採らない（extractRecommendationForDisplay と同方針）。
//
// 診断本文の実データ（本番163件）に基づく前提:
//   - 見出しは Markdown ATX（`## 4. 避けるべき求人の特徴`）と、記号見出し（`■` `【` `◆`）と、
//     行全体が太字だけの見出し（`**業種優先度**`）の3系統が混在する。**3系統すべてを境界として扱う**。
//   - 「業種」見出しは12種類の表記ゆれがあるため完全一致では拾えない（前方一致で判定する）。
//   - S/A/B は Markdown テーブル 149/163・箇条書き 6/163・構造なし 8/163。

/** 志向要約1件分。切り出せなかったブロックは null（空配列・空文字にはしない）。 */
export type CandidatePreference = {
  /** 業種の優先度。テーブル/箇条書きの「業種」セルのみ（「理由」列は含めない）。 */
  industryPriority: { s: string[]; a: string[]; b: string[] } | null;
  /** 「避けるべき求人の特徴」セクションの箇条書き。 */
  avoidPoints: string[] | null;
  /** シフト制に関する記述のみ（残業の記述は含めない）。複数行は改行区切り。 */
  shiftConstraint: string | null;
};

/**
 * 見出し行の判定。セクションの終端検出に使う。
 *
 * 実データに存在する3系統すべてを見出しとして扱う:
 *   1. `#`〜`######`（ATX）              例: `## 4. 避けるべき求人の特徴`
 *   2. 記号始まり（太字で囲まれていてもよい）例: `■ 検索条件（推奨）` / `**■ 絶対制約条件（最優先）**`
 *   3. 行全体が太字だけ                    例: `**職種キーワード**` / `**業種（S→A→B優先度）**`
 * 加えて水平線（`---`）もセクション終端として扱う（診断本文はセクション区切りに多用する）。
 *
 * 箇条書き（`- **S**：…`）やテーブル行（`| **S** | … |`）は行頭が `-` / `|` のため
 * どれにも該当しない＝見出しにならない。
 */
function isBoundaryLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^-{3,}$/.test(t)) return true; // 水平線
  if (/^#{1,6}\s/.test(t)) return true; // ATX
  if (/^(?:\*\*)?\s*[■【◆▼]/.test(t)) return true; // 記号見出し（太字可）
  if (/^\*\*[^*]+\*\*[：:]?$/.test(t)) return true; // 行全体が太字
  return false;
}

/**
 * `titleRe` に一致する見出し行から、次の見出し行の直前までを切り出す。
 * 見出しが無ければ null（＝推測で本文を切り出さない）。
 *
 * @returns 見出し行を除いた本文の行配列。本文が空なら null。
 */
function sliceSection(content: string, titleRe: RegExp): string[] | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    // 見出し行であること＋その見出しにタイトル語が含まれることの両方を要求する。
    // 本文中にたまたま同じ語が出てくる行（例:「避けたい：新宿・池袋」）を拾わないため。
    if (isBoundaryLine(lines[i]) && titleRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (isBoundaryLine(lines[i])) break;
    body.push(lines[i]);
  }
  return body.length ? body : null;
}

/** Markdown 装飾を落とす（太字・行頭の箇条書き記号・前後空白）。 */
function stripDeco(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/^\s*[-・*]\s*/, "")
    .trim();
}

/**
 * 表示用に1行を整形する。
 * テーブル行（`| 休日 | シフト制は原則除外 |`）は罫線が本文に混ざるため、セルを「：」で連結した
 * 素の文へ均す。テーブル行でなければ装飾除去のみ。
 */
function toPlainLine(line: string): string {
  const t = line.trim();
  if (t.startsWith("|")) {
    const cells = t
      .split("|")
      .map((c) => stripDeco(c))
      .filter((c) => c.length > 0 && !/^-+$/.test(c));
    return cells.join("：");
  }
  return stripDeco(line);
}

/**
 * 重複判定用のキー。「避けるべき」と「絶対制約条件」は同じ制約を語尾違いで言い直すことが多いため
 * （例:「完全シフト制（…）：絶対NG」と「完全シフト制（…）は不可」）、
 * 判定語・括弧書き・助詞・記号を落とした“芯”だけを比較対象にする。
 */
function dedupKey(s: string): string {
  return s
    .split(/[：:]/)[0] // 「…：絶対NG」の判定部分を落とす
    .replace(/[（(][^）)]*[）)]/g, "") // 括弧書きの補足を落とす
    .replace(/(?:の求人)?は?(?:全て)?(?:原則)?(?:除外|対象外|不可|NG|避ける|不可能)。?$/u, "") // 末尾の判定語
    .replace(/[のはがをもとにへでや、。・,.\s]/gu, "") // 助詞・記号・空白
    .replace(/あり/gu, "") // 「夜勤あり・シフト制」と「夜勤・シフト制」を同一視（「なし」は残すので否定は潰れない）
    .trim();
}

/** 行配列から箇条書き項目だけを取り出す（装飾除去済み・空要素と極端に短い行は捨てる）。 */
function bulletsOf(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!/^\s*[-・*]\s+/.test(line)) continue;
    const t = stripDeco(line);
    if (t.length > 3) out.push(t);
  }
  return out;
}

/** 「S」「Ａ」等の全角/太字ゆれを吸収してランク1文字に正規化。 */
function toRank(raw: string): "s" | "a" | "b" | null {
  const c = raw.replace(/[*\s]/g, "").toUpperCase();
  if (c === "S" || c === "Ｓ") return "s";
  if (c === "A" || c === "Ａ") return "a";
  if (c === "B" || c === "Ｂ") return "b";
  return null;
}

/**
 * 業種セルの整形。「理由」を落とし業種名だけを残す。
 * - テーブル形式は「理由」が独立した列なので、ここに渡る時点で理由は含まれない。
 * - 箇条書き形式は `→` の後ろに理由が続く形があるため、その分だけ落とす。
 *   丸括弧は業種名の一部（例「不動産業界（管理・開発・仲介）」）でもあり機械的に区別できないため残す。
 */
function cleanIndustryCell(s: string): string {
  return stripDeco(s.split(/\s*(?:→|⇒)\s*/)[0]).replace(/^[：:]\s*/, "").trim();
}

/**
 * 業種の S/A/B 優先度を切り出す。
 * テーブル形式（`| **S** | 業種名 | 理由 |`）と箇条書き形式（`- S：業種名`）の両方に対応。
 * 「業種」見出しが無い場合・S/A/B が1つも取れない場合は null。
 */
function parseIndustryPriority(content: string): CandidatePreference["industryPriority"] {
  // 「業種」を含む見出し配下だけを対象にする（本文中の無関係なテーブルを拾わない）。
  const body = sliceSection(content, /業種/);
  if (!body) return null;

  const acc: { s: string[]; a: string[]; b: string[] } = { s: [], a: [], b: [] };

  for (const line of body) {
    // テーブル行: | **S** | 業種名 | 理由 |  → 2列目のみ採用（3列目の理由は捨てる）
    const tbl = line.match(/^\s*\|([^|]+)\|([^|]+)\|/);
    if (tbl) {
      const rank = toRank(tbl[1]);
      if (!rank) continue; // ヘッダ行（| 優先度 | 業種 | 理由 |）や区切り行（|---|---|）はここで落ちる
      const cell = cleanIndustryCell(tbl[2]);
      if (cell) acc[rank].push(cell);
      continue;
    }
    // 箇条書き: - **S**：業種名、業種名（→ 理由）
    const bul = line.match(/^\s*[-・*]\s*\**\s*([SABＳＡＢ])\s*\**\s*[：:]\s*(.+)$/);
    if (bul) {
      const rank = toRank(bul[1]);
      if (!rank) continue;
      const cell = cleanIndustryCell(bul[2]);
      if (cell) acc[rank].push(cell);
    }
  }

  if (!acc.s.length && !acc.a.length && !acc.b.length) return null;
  return acc;
}

/**
 * 「避けるべき求人の特徴」の箇条書きを切り出す。
 * 見出しが無い・箇条書きが1件も無い場合は null。
 */
function parseAvoidPoints(content: string): string[] | null {
  const body = sliceSection(content, /避け/);
  if (!body) return null;
  const bullets = bulletsOf(body);
  return bullets.length ? bullets : null;
}

/**
 * シフト制に関する記述のみを切り出す。
 *
 * 「避けるべき求人の特徴」と「絶対制約条件」の**両方**を走査する。
 * 実データでは片方にしか書かれないことがあるため、どちらか一方しか無くても拾える。
 * 同一文言が両方にある場合は重複させない（装飾除去後の文字列で判定）。
 *
 * 残業に関する記述は拾わない（業務判断による除外指定）。
 * 「シフト」を含む行だけを採るため、残業のみに言及する行（例「残業30時間超」）は構造上マッチしない。
 */
function parseShiftConstraint(content: string): string | null {
  const sources = [sliceSection(content, /避け/), sliceSection(content, /絶対制約/)];

  const keys: string[] = [];
  const out: string[] = [];
  for (const body of sources) {
    if (!body) continue;
    for (const line of body) {
      if (!/シフト/.test(line)) continue;
      const t = toPlainLine(line);
      if (t.length <= 3) continue;

      // 芯が一致する／どちらかがもう一方を包含する行は同一の制約とみなして1つに畳む。
      // 短すぎる芯（例「休日」）は無関係な行と偶然一致するため包含判定から除く。
      const k = dedupKey(t);
      const dup = keys.some(
        (prev) =>
          prev === k ||
          (k.length >= 6 && prev.includes(k)) ||
          (prev.length >= 6 && k.includes(prev)),
      );
      if (dup) continue;

      keys.push(k);
      out.push(t);
    }
  }
  return out.length ? out.join("\n") : null;
}

/**
 * 診断本文から志向要約3ブロックを切り出す。
 * 3ブロックすべてが null なら、呼び出し側が preference 自体を null にできるよう all-null のまま返す。
 */
export function extractCandidatePreference(content: string | null | undefined): CandidatePreference {
  if (!content) {
    return { industryPriority: null, avoidPoints: null, shiftConstraint: null };
  }
  return {
    industryPriority: parseIndustryPriority(content),
    avoidPoints: parseAvoidPoints(content),
    shiftConstraint: parseShiftConstraint(content),
  };
}

/** 3ブロックとも取れなかったか（＝preference を返す価値が無いか）。 */
export function isEmptyPreference(p: CandidatePreference): boolean {
  return p.industryPriority === null && p.avoidPoints === null && p.shiftConstraint === null;
}

/**
 * 診断日時を JST の日付（YYYY-MM-DD）に変換する。
 * Railway は UTC 稼働のため `toISOString().slice(0,10)` は日付がずれる（罠#17）。
 */
export function toJstDate(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
