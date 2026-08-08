import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { extractTokenFromMypageUrl } from "@/lib/candidate-site/preview-url";
import {
  SELECTION_SECTIONS,
  NOTIFIED_REJECTION_PERSON_FLAGS,
  classifySelectionSection,
  selectionDetailLabel,
  type SelectionSection,
} from "@/lib/entries/selection-status-label";

// エントリー管理 → 求職者向け「現在の選考状況＋各求人ページURL」案内文の生成。
//
// 調査根拠: docs/reports/entry-url-format-correction.md（最新・正）
//           docs/reports/entry-message-generator-survey.md（分類・フラグの実態）
//
// ── URL組み立ての鉄則（最重要・cdd6d01 §2-2）─────────────────────────────
//   URL形式を決めるのは台帳（CandidateFile）であって JobEntry ではない。
//     台帳行に externalJobRef あり            → /site/{token}/jobs/{externalJobRef}
//     台帳行に externalJobRef なし & kyuujinJobId あり → /site/{token}/pdf/{kyuujinJobId}
//     両方なし                                 → URLなし（会社名のみ）
//   - JobEntry.externalJobId をURLに埋め込んではいけない（形式もIDも実際と異なる）。
//   - 台帳の source_type 列で判定してはいけない。source_type が NULL でも externalJobRef を
//     持つ行が 4,505件ある（cdd6d01 §2-3）。判定は externalJobRef の有無だけで行う。
//   - 判定順序は配信API src/app/api/external/candidate-site/favorites/route.ts の
//     jpNormalize() と同一（externalJobRef があれば無条件で job-platform 形へ昇格）。
//
// ── トークン取得 ───────────────────────────────────────────────────────
//   kyuujinPDF の読み取り専用GET /api/external/mypage/by-job-seeker/{candidateNumber} のみ使用。
//   POST /api/external/tokens/issue（新規発行）は既存トークンを作り替える恐れがあるため絶対に呼ばない。
//   ?admin=true&secret=... 付きURLは出力しない（/v/{token} から token だけを取り出して組み立てる）。

export const dynamic = "force-dynamic";

type Body = {
  candidateId?: unknown;
  entryIds?: unknown;
  includeInactive?: unknown;
};

type LedgerRow = {
  id: string;
  kyuujinJobId: number | null;
  externalJobRef: string | null;
  archivedAt: Date | null;
};

type EntryRow = {
  id: string;
  candidateId: string;
  companyName: string;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  personFlag: string | null;
  externalJobId: number;
  externalJobRef: string | null;
};

/**
 * エントリーに対応する台帳行（CandidateFile category=BOOKMARK）を1行に決める。
 * 結合条件は cdd6d01 §3 のSQLと同一:
 *   (externalJobId > 0 かつ kyuujinJobId 一致) または (externalJobRef 一致)
 * 複数ヒット時は archivedAt IS NULL を優先し、それでも複数なら id 昇順の先頭。
 */
function pickLedgerRow(entry: EntryRow, ledger: LedgerRow[]): LedgerRow | null {
  const matched = ledger.filter(
    (f) =>
      (entry.externalJobId > 0 && f.kyuujinJobId !== null && f.kyuujinJobId === entry.externalJobId) ||
      (entry.externalJobRef !== null && f.externalJobRef !== null && f.externalJobRef === entry.externalJobRef),
  );
  if (matched.length === 0) return null;
  const sorted = [...matched].sort((a, b) => {
    const aArchived = a.archivedAt ? 1 : 0;
    const bArchived = b.archivedAt ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived; // 未アーカイブ優先
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // id 昇順
  });
  return sorted[0];
}

/** 台帳行から求職者サイトの求人ページURLを組み立てる。出せない場合は null。 */
function buildJobUrl(siteBase: string, token: string, row: LedgerRow | null): string | null {
  if (!row) return null;
  const base = `${siteBase.replace(/\/+$/, "")}/site/${encodeURIComponent(token)}`;
  if (row.externalJobRef) return `${base}/jobs/${encodeURIComponent(row.externalJobRef)}`;
  if (row.kyuujinJobId !== null) return `${base}/pdf/${row.kyuujinJobId}`;
  return null;
}

type CompanyBlock = { companyName: string; detail: string; urls: string[] };

/** 案内文の全文を組み立てる。同一会社は1行にまとめ、URLだけを複数行並べる。 */
function buildMessage(
  candidateName: string,
  advisorName: string,
  bySection: Map<SelectionSection, CompanyBlock[]>,
): string {
  const parts: string[] = [];
  parts.push(`${candidateName} 様`);
  parts.push("");
  parts.push(
    `お世話になっております。株式会社ビズスタジオの${advisorName}です。\n` +
      `現在の選考状況をまとめてご連絡いたします。各社名の下のURLから、そのまま求人内容をご確認いただけます。`,
  );
  parts.push("");

  for (const section of SELECTION_SECTIONS) {
    const blocks = bySection.get(section);
    if (!blocks || blocks.length === 0) continue; // 該当0件のセクションは出力しない
    parts.push(`■ ${section}`);
    parts.push("");
    for (const b of blocks) {
      parts.push(b.detail ? `・${b.companyName}（${b.detail}）` : `・${b.companyName}`);
      for (const u of b.urls) parts.push(u);
      parts.push("");
    }
  }

  parts.push("引き続きサポートさせていただきますので、よろしくお願いいたします。");
  return parts.join("\n");
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
  const entryIds = Array.isArray(body.entryIds)
    ? body.entryIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const includeInactive = body.includeInactive === true;

  if (!candidateId) {
    return NextResponse.json({ error: "candidateId が必要です" }, { status: 400 });
  }
  if (entryIds.length === 0 && !includeInactive) {
    return NextResponse.json({ error: "エントリーが選択されていません" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true, candidateNumber: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  // ── 対象エントリーの取得 ──────────────────────────────────────────────
  const entrySelect = {
    id: true,
    candidateId: true,
    companyName: true,
    entryFlag: true,
    entryFlagDetail: true,
    personFlag: true,
    externalJobId: true,
    externalJobRef: true,
  } as const;

  const selected: EntryRow[] = entryIds.length
    ? await prisma.jobEntry.findMany({ where: { id: { in: entryIds } }, select: entrySelect })
    : [];

  // 他の求職者のデータ混入防止: 1件でも候補者が違えば 400 で弾く。
  const foreign = selected.filter((e) => e.candidateId !== candidate.id);
  if (foreign.length > 0) {
    return NextResponse.json(
      { error: "選択されたエントリーに他の求職者のものが含まれています" },
      { status: 400 },
    );
  }

  const byId = new Map<string, EntryRow>(selected.map((e) => [e.id, e]));

  if (includeInactive) {
    // 見送り済み（本人へ通知済み・is_active=false）の行を追加で拾う。
    // 通知済みになった行は INACTIVE_TRIGGERS で is_active=false に落ちるため、通常表示には出てこない。
    const inactive = await prisma.jobEntry.findMany({
      where: {
        candidateId: candidate.id,
        isActive: false,
        personFlag: { in: [...NOTIFIED_REJECTION_PERSON_FLAGS] },
      },
      select: entrySelect,
    });
    for (const e of inactive) if (!byId.has(e.id)) byId.set(e.id, e);
  }

  const entries = [...byId.values()];
  if (entries.length === 0) {
    return NextResponse.json({ error: "対象のエントリーがありません" }, { status: 400 });
  }

  // ── 本人トークンの取得（読み取り専用GETのみ・新規発行はしない） ─────────────
  if (!candidate.candidateNumber) {
    return NextResponse.json(
      { ok: false, reason: "no-token", error: "マイページURLが未発行です" },
      { status: 409 },
    );
  }

  const kyuujinApiUrl = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
  const kyuujinApiSecret = process.env.KYUUJIN_API_SECRET;
  if (!kyuujinApiSecret) {
    console.error("[entries/generate-message] KYUUJIN_API_SECRET 未設定");
    return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 });
  }

  let mypageUrl: string | null = null;
  try {
    const res = await fetch(
      `${kyuujinApiUrl}/api/external/mypage/by-job-seeker/${encodeURIComponent(candidate.candidateNumber)}`,
      { headers: { "x-api-secret": kyuujinApiSecret }, cache: "no-store" },
    );
    if (!res.ok) {
      console.error(`[entries/generate-message] kyuujinPDF error status=${res.status}`);
      return NextResponse.json({ error: "マイページURLの取得に失敗しました" }, { status: 502 });
    }
    const data = (await res.json()) as { url?: string | null };
    mypageUrl = data.url ?? null;
  } catch (e) {
    console.error("[entries/generate-message] kyuujinPDF fetch threw:", e);
    return NextResponse.json({ error: "マイページURLの取得に失敗しました" }, { status: 502 });
  }

  if (!mypageUrl) {
    return NextResponse.json(
      { ok: false, reason: "no-token", error: "マイページURLが未発行です" },
      { status: 409 },
    );
  }

  const token = extractTokenFromMypageUrl(mypageUrl);
  if (!token) {
    console.error(`[entries/generate-message] token 抽出失敗 url=${mypageUrl.slice(0, 120)}`);
    return NextResponse.json({ error: "マイページURLの形式が不正です" }, { status: 502 });
  }

  // ── 台帳（CandidateFile category=BOOKMARK）を候補者スコープで取得 ─────────────
  const ledger: LedgerRow[] = await prisma.candidateFile.findMany({
    where: { candidateId: candidate.id, category: "BOOKMARK" },
    select: { id: true, kyuujinJobId: true, externalJobRef: true, archivedAt: true },
  });

  const siteBase = process.env.MYPAGE_PREVIEW_BASE_URL || "https://mypage.bizstudio.co.jp";

  // ── 分類・会社単位の集約 ────────────────────────────────────────────────
  const bySection = new Map<SelectionSection, CompanyBlock[]>();
  const blockIndex = new Map<string, CompanyBlock>(); // key: section + " " + companyName
  const companiesWithoutUrl: string[] = [];
  let total = 0;
  let withUrl = 0;
  let withoutUrl = 0;
  let unclassified = 0;

  for (const entry of entries) {
    const section = classifySelectionSection(entry);
    if (!section) {
      unclassified++;
      continue;
    }
    total++;

    const url = buildJobUrl(siteBase, token, pickLedgerRow(entry, ledger));
    if (url) withUrl++;
    else {
      withoutUrl++;
      if (!companiesWithoutUrl.includes(entry.companyName)) companiesWithoutUrl.push(entry.companyName);
    }

    const key = `${section} ${entry.companyName}`;
    let block = blockIndex.get(key);
    if (!block) {
      block = { companyName: entry.companyName, detail: "", urls: [] };
      blockIndex.set(key, block);
      const list = bySection.get(section);
      if (list) list.push(block);
      else bySection.set(section, [block]);
    }
    // 補足文言は同一会社の最初の非空を採用（別求人で状況が違う場合の重複表示を避ける）。
    if (!block.detail) block.detail = selectionDetailLabel(entry.entryFlagDetail, section);
    if (url && !block.urls.includes(url)) block.urls.push(url);
  }

  if (total === 0) {
    return NextResponse.json(
      { error: "選考状況を判定できるエントリーがありませんでした" },
      { status: 400 },
    );
  }

  const advisorName = user.name?.trim() || "担当";
  const message = buildMessage(candidate.name, advisorName, bySection);

  return NextResponse.json({
    message,
    stats: { total, withUrl, withoutUrl, companiesWithoutUrl, unclassified },
  });
}
