/**
 * T-159 Phase 3: フォルダURLの自動登録 / 移動追随 / 鍵の期限通知のユニットテスト。
 *
 * scripts/test-t159-onedrive-sync.ts と同じ自己完結アサーションランナー方式
 * （本リポジトリに vitest/jest は入っていない）。
 *
 * 実行:
 *   npx tsx scripts/test-t159-folder-url.ts
 *
 * ★ネットワーク・DB には一切アクセスしない（すべて純関数のテスト）。
 *   Graph 走査だけは listChildrenByPath を差し替えた偽ドライブで検査する。
 *
 * 終了コード: 全件パス=0 / 1件でも失敗=1
 */

import type { DriveItem } from "@/lib/microsoft-graph";
import {
  ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS,
  ONEDRIVE_SCAN_ROOT,
  buildOneDriveFolderUrl,
  folderNameMatchesCandidate,
  folderUrlRoundTrips,
  isScanTrustworthy,
  matchCandidateFolder,
  normalizeNameForMatch,
  ownerSegmentFromUpn,
  scanOneDriveCandidateFolders,
  sharePointEncodePath,
  splitCandidateFolderName,
  type OneDriveFolderScanResult,
} from "@/lib/onedrive-folder-scan";
import {
  ONEDRIVE_FOLDER_URL_MOVE_MAX_UPDATES,
  ONEDRIVE_FOLDER_URL_MOVE_RECENT_FILE_DAYS,
  ONEDRIVE_FOLDER_URL_MOVE_STATUSES,
  buildFolderUrlMoveWhere,
  buildFolderUrlRegisterWhere,
  decideFolderUrlMoveApplication,
  isAutoManagedFolderUrl,
} from "@/lib/onedrive-folder-url-sync";
import {
  GRAPH_SECRET_NOTICE_DAYS_LEFT,
  buildGraphSecretExpiryNotification,
  evaluateGraphSecretExpiry,
} from "@/lib/onedrive-graph-secret";
import { buildOneDriveNightlyNotification } from "@/lib/onedrive-sync-notify";
import type { OneDriveSyncRetrySummary } from "@/lib/onedrive-sync-retry";
import type { OneDriveFolderUrlSyncSummary } from "@/lib/onedrive-folder-url-sync";

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual);
  const e = typeof expected === "string" ? expected : JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}  → ${a}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}\n      実際: ${a}\n      期待: ${e}`);
  }
}

const OWNER = "masayuki_oono_bizstudio_co_jp";

// ============================================================
// [1] フォルダ名の解釈（T-158 と同一規則であること）
// ============================================================
console.log("\n[1] フォルダ名の解釈 splitCandidateFolderName");
{
  eq("番号_氏名", splitCandidateFolderName("5008391_三原 優香"), {
    number: "5008391",
    namePart: "三原 優香",
  });
  eq("番号 氏名（半角空白）", splitCandidateFolderName("5000051 石井美優"), {
    number: "5000051",
    namePart: "石井美優",
  });
  eq("番号　氏名（全角空白）", splitCandidateFolderName("5000051　石井美優"), {
    number: "5000051",
    namePart: "石井美優",
  });
  eq("番号-氏名", splitCandidateFolderName("5000051-石井美優"), {
    number: "5000051",
    namePart: "石井美優",
  });
  eq("番号のみ", splitCandidateFolderName("5000051"), { number: "5000051", namePart: "" });
  eq("番号なし", splitCandidateFolderName("山本すみれ"), {
    number: "",
    namePart: "山本すみれ",
  });
  eq(
    "氏名内の空白は残す（区切りだけ落とす）",
    splitCandidateFolderName("5008408_前川 駿介").namePart,
    "前川 駿介",
  );
}

// ============================================================
// [2] 氏名照合（登録してよいかの検証にしか使わない）
// ============================================================
console.log("\n[2] 氏名照合 normalizeNameForMatch / folderNameMatchesCandidate");
{
  eq("空白を落とす", normalizeNameForMatch("三原 優香"), "三原優香");
  eq("全角空白を落とす", normalizeNameForMatch("三原　優香"), "三原優香");
  eq("中黒を落とす", normalizeNameForMatch("ジョン・スミス"), "ジョンスミス");
  eq("長音は落とさない", normalizeNameForMatch("キーラ"), "キーラ");
  eq("全角英数は半角化（NFKC）", normalizeNameForMatch("ＡＢＣ"), "ABC");

  eq("一致する", folderNameMatchesCandidate("三原 優香", "三原優香"), true);
  eq(
    "フォルダ名末尾の付記は許容する（_close / 支援終了 等）",
    folderNameMatchesCandidate("三原 優香", "三原優香_close"),
    true,
  );
  eq(
    "★氏名が食い違えば登録しない",
    folderNameMatchesCandidate("三原 優香", "前川 駿介"),
    false,
  );
  eq(
    "★フォルダ名が番号のみ（氏名部分が空）なら照合できないので登録しない",
    folderNameMatchesCandidate("三原 優香", ""),
    false,
  );
  eq("portal 氏名が空なら登録しない", folderNameMatchesCandidate("", "三原優香"), false);
  eq(
    "部分一致の向きは portal 氏名 ⊂ フォルダ氏名（逆は不可）",
    folderNameMatchesCandidate("三原優香子", "三原優香"),
    false,
  );
}

// ============================================================
// [3] URL の組み立て（T-158 の実データと byte 一致すること）
// ============================================================
console.log("\n[3] URL の組み立て（T-158 実データとの byte 一致）");
{
  // docs/reports/T-158_backup_before_update.csv の実値（求職者番号 5000051 の行）
  const expected =
    "https://bizstudio-my.sharepoint.com/my?id=%2Fpersonal%2Fmasayuki%5Foono%5Fbizstudio%5Fco%5Fjp%2FDocuments%2F%E3%83%93%E3%82%BA%E3%82%B9%E3%82%BF%E3%82%B8%E3%82%AA%2F6%2E%E6%B1%82%E8%81%B7%E8%80%85%E6%9B%B8%E9%A1%9E%E9%96%A2%E9%80%A3%2F1%2E%E5%A4%A7%E9%87%8E%2F2024%2F202312%2F5000051%5F%E7%9F%B3%E4%BA%95%E7%BE%8E%E5%84%AA";
  const drivePath = "/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/5000051_石井美優";
  eq("★T-158 の実URLと1バイトも違わない", buildOneDriveFolderUrl(OWNER, drivePath), expected);
  eq("viewid を付けない", buildOneDriveFolderUrl(OWNER, drivePath).includes("viewid"), false);

  eq("_ を %5F にする（Python quote 互換）", sharePointEncodePath("a_b"), "a%5Fb");
  eq(". を %2E にする", sharePointEncodePath("a.b"), "a%2Eb");
  eq("- を %2D にする", sharePointEncodePath("a-b"), "a%2Db");
  eq("~ を %7E にする", sharePointEncodePath("a~b"), "a%7Eb");
  eq("' を %27 にする（encodeURIComponent は残す）", sharePointEncodePath("a'b"), "a%27b");
  eq("( ) を変換する", sharePointEncodePath("a(b)"), "a%28b%29");
  eq("/ を %2F にする", sharePointEncodePath("a/b"), "a%2Fb");

  eq("UPN → 所有者セグメント", ownerSegmentFromUpn("masayuki_oono@bizstudio.co.jp"), OWNER);

  eq("組み立てたURLは元のパスに戻る", folderUrlRoundTrips(expected, drivePath), true);
  eq(
    "★別のパスと取り違えたURLは戻らない（フェイルクローズ）",
    folderUrlRoundTrips(expected, "/ビズスタジオ/6.求職者書類関連/1.大野/2024/202312/別人"),
    false,
  );
}

// ============================================================
// [4] Graph 走査（偽ドライブ）
// ============================================================
console.log("\n[4] Graph 走査 scanOneDriveCandidateFolders（偽ドライブ）");

/** パス → 子フォルダ名 の対応から listChildrenByPath を作る。 */
function fakeDrive(tree: Record<string, string[]>) {
  const calls: string[] = [];
  const fn = async (_upn: string, p: string): Promise<DriveItem[] | null> => {
    calls.push(p);
    const kids = tree[p];
    if (!kids) return null; // 404 相当
    return kids.map((name, i) => ({ id: `${p}/${name}#${i}`, name, folder: { childCount: 0 } }));
  };
  return { fn, calls };
}

const R = ONEDRIVE_SCAN_ROOT;
{
  // CA ごとに階層が違う実構造を再現する（T-158 実測: 大野=年/年月、小野=直下、安藤=年月）
  const tree: Record<string, string[]> = {
    [R]: ["1.大野", "2.小野", "4.安藤", "9.資料", "テンプレート"],
    [`${R}/1.大野`]: ["2026", "GPTメモ"],
    [`${R}/1.大野/2026`]: ["202608"],
    [`${R}/1.大野/2026/202608`]: ["5008391_三原 優香", "5008408_前川 駿介", "【原本】番号氏名"],
    [`${R}/2.小野`]: ["5001111_小野太郎"],
    [`${R}/4.安藤`]: ["202607"],
    [`${R}/4.安藤/202607`]: ["5002222_安藤花子", "支援終了"],
    [`${R}/4.安藤/202607/支援終了`]: ["5003333_過去 太郎", "5004444_過去 次郎"],
    [`${R}/9.資料`]: ["面接対策"], // 年/年月/番号 が無いので CA フォルダではない
  };
  const drive = fakeDrive(tree);
  const scanPromise = scanOneDriveCandidateFolders("upn", { listChildrenByPath: drive.fn });

  void (async () => {
    const scan = await scanPromise;
    eq("CA フォルダだけを拾う", scan.caFolders, ["1.大野", "2.小野", "4.安藤"]);
    eq("求職者フォルダ件数", scan.folders.length, 6);
    eq("番号で引ける件数", scan.byNumber.size, 6);
    eq(
      "年階層なし（2.小野 直下）も拾う",
      scan.byNumber.get("5001111")?.[0].drivePath,
      `${R}/2.小野/5001111_小野太郎`,
    );
    eq(
      "年月直下（4.安藤）も拾う",
      scan.byNumber.get("5002222")?.[0].drivePath,
      `${R}/4.安藤/202607/5002222_安藤花子`,
    );
    eq(
      "束ねフォルダ（支援終了）の中まで降りる",
      scan.byNumber.get("5003333")?.[0].drivePath,
      `${R}/4.安藤/202607/支援終了/5003333_過去 太郎`,
    );
    eq("テンプレフォルダは拾わない", scan.folders.some((f) => f.folderName.includes("原本")), false);
    eq("求職者フォルダの中は見ない", drive.calls.includes(`${R}/1.大野/2026/202608/5008391_三原 優香`), false);
    eq("完走した", scan.complete, true);
    eq("エラーなし", scan.errors.length, 0);
    eq(
      "★同じフォルダを二度 listChildren しない（束ね判定→降下でキャッシュが効く）",
      drive.calls.filter((c) => c === `${R}/4.安藤/202607/支援終了`).length,
      1,
    );
    eq("キャッシュヒットが発生している", scan.cacheHits > 0, true);

    // ---- 走査中の例外は「索引が不完全」として扱う ----
    const broken = async (_u: string, p: string): Promise<DriveItem[] | null> => {
      if (p === `${R}/4.安藤`) throw new Error("Graph 500");
      return drive.fn(_u, p);
    };
    const scan2 = await scanOneDriveCandidateFolders("upn", { listChildrenByPath: broken });
    eq("★listChildren が例外なら完走扱いにしない", scan2.complete, false);
    eq("エラーを記録する", scan2.errors.length > 0, true);
    eq("★不完全な索引は信用しない", isScanTrustworthy(scan2), false);

    await runRemainingTests(scan);
  })();
}

// ============================================================
// [5] 登録判定（番号一致 + 単一 + 氏名照合）
// ============================================================
async function runRemainingTests(smallScan: OneDriveFolderScanResult) {
  console.log("\n[5] 登録判定 matchCandidateFolder");
  {
    const ok = matchCandidateFolder({
      candidateNumber: "5008391",
      candidateName: "三原 優香",
      ownerSegment: OWNER,
      scan: smallScan,
    });
    eq("番号一致＋氏名一致なら登録できる", ok.ok, true);
    eq(
      "登録するURLは走査で見つけたパスから作る",
      ok.ok && ok.url === buildOneDriveFolderUrl(OWNER, `${R}/1.大野/2026/202608/5008391_三原 優香`),
      true,
    );

    eq(
      "★番号が一致しても氏名が食い違えば登録しない",
      matchCandidateFolder({
        candidateNumber: "5008391",
        candidateName: "別人 太郎",
        ownerSegment: OWNER,
        scan: smallScan,
      }),
      { ok: false, reason: "NAME_MISMATCH", detail: "portal氏名=別人 太郎 / フォルダ氏名=三原 優香" },
    );

    eq(
      "番号一致のフォルダが無ければ登録しない",
      matchCandidateFolder({
        candidateNumber: "5009999",
        candidateName: "誰か",
        ownerSegment: OWNER,
        scan: smallScan,
      }).ok,
      false,
    );
    eq(
      "求職者番号が空なら登録しない",
      matchCandidateFolder({
        candidateNumber: "",
        candidateName: "三原 優香",
        ownerSegment: OWNER,
        scan: smallScan,
      }),
      { ok: false, reason: "NO_CANDIDATE_NUMBER", detail: "求職者番号が未設定" },
    );

    // ---- 候補フォルダが複数 ----
    const dupTree: Record<string, string[]> = {
      [R]: ["1.大野", "4.安藤"],
      [`${R}/1.大野`]: ["202608"],
      [`${R}/1.大野/202608`]: ["5008391_三原 優香"],
      [`${R}/4.安藤`]: ["202608"],
      [`${R}/4.安藤/202608`]: ["5008391_三原 優香"],
    };
    const dupScan = await scanOneDriveCandidateFolders("upn", {
      listChildrenByPath: fakeDrive(dupTree).fn,
    });
    eq("同じ番号のフォルダを2件とも索引に入れる", dupScan.byNumber.get("5008391")?.length, 2);
    const dup = matchCandidateFolder({
      candidateNumber: "5008391",
      candidateName: "三原 優香",
      ownerSegment: OWNER,
      scan: dupScan,
    });
    eq(
      "★候補フォルダが複数なら（氏名が両方一致しても）登録しない",
      dup.ok === false && dup.reason,
      "DUPLICATE_FOLDER",
    );
  }

  // ============================================================
  // [6] 安全弁1: 走査の信用性
  // ============================================================
  console.log("\n[6] 安全弁1 isScanTrustworthy");
  {
    const base = (folders: number, complete: boolean): OneDriveFolderScanResult => ({
      complete,
      folders: Array.from({ length: folders }, (_, i) => ({
        candidateNumber: String(5000000 + i),
        namePart: "x",
        folderName: "x",
        drivePath: "/x",
        caFolder: "1.大野",
      })),
      byNumber: new Map(),
      caFolders: [],
      allCaFolders: [],
      listCalls: 0,
      cacheHits: 0,
      errors: [],
      durationMs: 0,
    });
    eq("実測1,734件相当は信用する", isScanTrustworthy(base(1734, true)), true);
    eq("下限ちょうどは信用する", isScanTrustworthy(base(ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS, true)), true);
    eq(
      "★異常に少なければ信用しない",
      isScanTrustworthy(base(ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS - 1, true)),
      false,
    );
    eq("★件数が足りていても未完走なら信用しない", isScanTrustworthy(base(1734, false)), false);
  }

  // ============================================================
  // [7] 台帳による手貼りの保護
  // ============================================================
  console.log("\n[7] 手貼りの保護 isAutoManagedFolderUrl");
  {
    const url = "https://bizstudio-my.sharepoint.com/my?id=%2Fa";
    eq("台帳の値と一致すれば自動管理下", isAutoManagedFolderUrl(url, { autoUrl: url }), true);
    eq("★台帳が無いURL（手貼り）は404でも触らない", isAutoManagedFolderUrl(url, null), false);
    eq(
      "★自動登録後にCAが貼り替えたURLは触らない（台帳行はあるが値が違う）",
      isAutoManagedFolderUrl("https://example.com/other", { autoUrl: url }),
      false,
    );
    eq("URLが空なら対象外", isAutoManagedFolderUrl(null, { autoUrl: url }), false);
  }

  // ============================================================
  // [8] 安全弁2: 更新件数の上限
  // ============================================================
  console.log("\n[8] 安全弁2 decideFolderUrlMoveApplication");
  {
    eq("上限内なら適用する", decideFolderUrlMoveApplication({ plannedUpdates: 50, scanTrustworthy: true }), {
      apply: true,
      blocked: null,
    });
    eq(
      "★上限を1件でも超えたら1件も更新せず報告のみ",
      decideFolderUrlMoveApplication({ plannedUpdates: 51, scanTrustworthy: true }),
      { apply: false, blocked: "TOO_MANY_UPDATES" },
    );
    eq(
      "★走査が信用できなければ件数に関係なく更新しない",
      decideFolderUrlMoveApplication({ plannedUpdates: 1, scanTrustworthy: false }),
      { apply: false, blocked: "SCAN_UNTRUSTWORTHY" },
    );
    eq("0件なら適用（何も起きない）", decideFolderUrlMoveApplication({ plannedUpdates: 0, scanTrustworthy: true }).apply, true);
    eq("上限の既定値は50", ONEDRIVE_FOLDER_URL_MOVE_MAX_UPDATES, 50);
  }

  // ============================================================
  // [9] 抽出条件（絞り込みが効いていること）
  // ============================================================
  console.log("\n[9] 抽出条件 buildFolderUrlRegisterWhere / buildFolderUrlMoveWhere");
  {
    const rw = buildFolderUrlRegisterWhere();
    eq("機能1: SKIPPED(NO_FOLDER_URL) の行を持つ者に限る", JSON.stringify(rw), JSON.stringify({
      status: "SKIPPED",
      skipReason: "NO_FOLDER_URL",
      candidate: { oneDriveFolderUrl: null },
    }));

    const NOW = new Date("2026-08-17T17:00:00.000Z"); // JST 2026-08-18 02:00
    const mw = buildFolderUrlMoveWhere(NOW);
    eq("機能2: URL登録済みだけ", JSON.stringify(mw.oneDriveFolderUrl), JSON.stringify({ not: null }));
    eq("機能2: ★全1,734人を毎晩見ない（OR で絞る）", Array.isArray(mw.OR), true);
    eq(
      "機能2: 支援中/待機",
      JSON.stringify(mw.OR?.[0]),
      JSON.stringify({ supportStatus: { in: [...ONEDRIVE_FOLDER_URL_MOVE_STATUSES] } }),
    );
    const cutoff = new Date(
      NOW.getTime() - ONEDRIVE_FOLDER_URL_MOVE_RECENT_FILE_DAYS * 24 * 60 * 60 * 1000,
    );
    eq(
      "機能2: 直近30日にファイルが作られた人",
      JSON.stringify(mw.OR?.[1]),
      JSON.stringify({ files: { some: { createdAt: { gte: cutoff } } } }),
    );
    eq("絞り込み期間は30日", ONEDRIVE_FOLDER_URL_MOVE_RECENT_FILE_DAYS, 30);
  }

  // ============================================================
  // [10] 機能3: 鍵の期限
  // ============================================================
  console.log("\n[10] 鍵の期限 evaluateGraphSecretExpiry");
  {
    // JST で 2026-08-18 02:00 の晩に走る想定
    const NOW = new Date("2026-08-17T17:00:00.000Z");
    const ev = (raw: string | null | undefined) => evaluateGraphSecretExpiry(NOW, raw);

    eq("★未設定なら通知しない", ev(undefined), {
      state: "UNSET",
      expiresAt: null,
      daysLeft: null,
      notify: false,
    });
    eq("空文字も未設定扱い", ev("   ").state, "UNSET");

    eq("残り60日は節目", ev("2026-10-17"), {
      state: "NOTICE",
      expiresAt: "2026-10-17",
      daysLeft: 60,
      notify: true,
    });
    eq("残り61日は通知しない", ev("2026-10-18").notify, false);
    eq("残り59日は通知しない（節目を跨いだ翌日）", ev("2026-10-16").notify, false);
    for (const d of GRAPH_SECRET_NOTICE_DAYS_LEFT) {
      const target = new Date(Date.UTC(2026, 7, 18) + d * 86_400_000);
      const ymd = target.toISOString().slice(0, 10);
      eq(`★残り${d}日は節目で通知する`, ev(ymd), {
        state: "NOTICE",
        expiresAt: ymd,
        daysLeft: d,
        notify: true,
      });
    }
    eq("節目は6つだけ", GRAPH_SECRET_NOTICE_DAYS_LEFT.length, 6);
    eq("残り2日（節目でない）は通知しない", ev("2026-08-20").notify, false);

    eq("★期限当日は通知する", ev("2026-08-18"), {
      state: "EXPIRED",
      expiresAt: "2026-08-18",
      daysLeft: 0,
      notify: true,
    });
    eq("★期限切れは毎日通知する", ev("2026-08-01"), {
      state: "EXPIRED",
      expiresAt: "2026-08-01",
      daysLeft: -17,
      notify: true,
    });

    eq("★日付として読めない値は設定ミスとして通知する", ev("2028/08/17").state, "INVALID");
    eq("存在しない日付も設定ミス", ev("2026-02-30").state, "INVALID");
    eq("設定ミスは通知する", ev("いつか").notify, true);

    // JST 境界: UTC で日付が変わっても JST の暦日で数える
    eq(
      "JST の暦日で数える（UTC 15:00 = JST 翌日 00:00）",
      evaluateGraphSecretExpiry(new Date("2026-08-17T15:00:00.000Z"), "2026-10-17").daysLeft,
      60,
    );
    eq(
      "同じ JST 日なら残り日数は変わらない",
      evaluateGraphSecretExpiry(new Date("2026-08-18T14:59:00.000Z"), "2026-10-17").daysLeft,
      60,
    );
  }

  console.log("\n[11] 鍵の期限の文面 buildGraphSecretExpiryNotification");
  {
    const NOW = new Date("2026-08-17T17:00:00.000Z");
    const notice = buildGraphSecretExpiryNotification(evaluateGraphSecretExpiry(NOW, "2026-09-17"));
    eq("残り日数と期限を書く", notice?.includes("残り30日（期限: 2026-09-17）"), true);
    eq("止まることを書く", notice?.includes("書類のコピーが止まります"), true);
    eq("エラーが出ないことを書く", notice?.includes("エラーは出ないため"), true);
    eq(
      "★技術用語を出さない（シークレット/Azure/トークン）",
      /シークレット|Azure|トークン|クライアント/.test(notice ?? ""),
      false,
    );
    eq(
      "★通知不要な評価では文面を作らない",
      buildGraphSecretExpiryNotification(evaluateGraphSecretExpiry(NOW, "2027-01-01")),
      null,
    );
    eq(
      "未設定では文面を作らない",
      buildGraphSecretExpiryNotification(evaluateGraphSecretExpiry(NOW, undefined)),
      null,
    );
    const expired = buildGraphSecretExpiryNotification(evaluateGraphSecretExpiry(NOW, "2026-08-15"));
    eq("期限切れは切れたと書く", expired?.includes("有効期限が切れています"), true);
    eq("何日過ぎたかを書く", expired?.includes("期限を3日過ぎています"), true);
  }

  // ============================================================
  // [12] 通知の統合（1通にまとめる / 出すものが無ければ送らない）
  // ============================================================
  console.log("\n[12] 通知の統合 buildOneDriveNightlyNotification");
  {
    const AT = new Date("2026-08-17T17:05:00.000Z"); // JST 8/18 02:05
    const retry = (over: Partial<OneDriveSyncRetrySummary> = {}): OneDriveSyncRetrySummary => ({
      mode: "execute",
      syncEnabled: true,
      eligible: 0,
      picked: 0,
      processed: 0,
      deferred: 0,
      success: 0,
      givenUp: 0,
      byStatus: {},
      bySkipReason: {},
      needsAttention: [],
      missingSubfolders: [],
      durationMs: 1,
      ...over,
    });
    const fu = (over: {
      registered?: number;
      moved?: number;
      blocked?: "TOO_MANY_UPDATES" | "SCAN_UNTRUSTWORTHY" | null;
      planned?: number;
      trustworthy?: boolean;
      abortedReason?: string | null;
    }): OneDriveFolderUrlSyncSummary => ({
      mode: "execute",
      abortedReason: over.abortedReason ?? null,
      ownerSegment: OWNER,
      scan: {
        complete: true,
        trustworthy: over.trustworthy ?? true,
        folders: 1828,
        withNumber: 1736,
        minExpected: ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS,
        caFolders: [],
        listCalls: 215,
        cacheHits: 32,
        errors: [],
        durationMs: 20000,
      },
      register: {
        targets: 0,
        picked: 0,
        deferred: 0,
        registered: over.registered ?? 0,
        registrable: over.registered ?? 0,
        byRejection: {},
        details: [],
      },
      move: {
        scoped: 125,
        protectedManual: 0,
        checked: 125,
        alive: 125,
        missing: 0,
        planned: over.planned ?? 0,
        updated: over.moved ?? 0,
        notRelocated: 0,
        blocked: over.blocked ?? null,
        maxUpdates: 50,
        details: [],
      },
      durationMs: 30000,
    });

    eq(
      "★何も起きていない晩は送らない",
      buildOneDriveNightlyNotification({ retry: retry(), folderUrl: fu({}), secret: null }, AT),
      null,
    );

    const auto = buildOneDriveNightlyNotification(
      { retry: retry({ success: 12 }), folderUrl: fu({ registered: 2, moved: 1 }), secret: null },
      AT,
    );
    eq("自動登録が起きた晩は送る", auto !== null, true);
    eq("日付が入る", auto?.includes("OneDriveへの書類コピー（8/18 深夜分）"), true);
    eq("コピー完了件数が入る", auto?.includes("コピー完了: 12件"), true);
    eq("自動登録の件数が入る", auto?.includes("・OneDriveフォルダの場所を自動で登録しました: 2名"), true);
    eq("付け替えの件数が入る", auto?.includes("・フォルダの移動に合わせてリンクを付け替えました: 1名"), true);
    eq(
      "★技術用語を出さない",
      /URL|SKIPPED|NO_FOLDER|台帳|Graph/.test(auto ?? ""),
      false,
    );

    const blocked = buildOneDriveNightlyNotification(
      { retry: retry(), folderUrl: fu({ blocked: "TOO_MANY_UPDATES", planned: 80 }), secret: null },
      AT,
    );
    eq("★安全弁が作動した晩は送る", blocked !== null, true);
    eq(
      "保留した件数と上限を書く",
      blocked?.includes("リンクの付け替えが一度に多すぎるため保留しました: 80名（上限 50名）"),
      true,
    );

    const untrusted = buildOneDriveNightlyNotification(
      { retry: retry(), folderUrl: fu({ blocked: "SCAN_UNTRUSTWORTHY", trustworthy: false }), secret: null },
      AT,
    );
    eq(
      "走査が信用できない晩も知らせる",
      untrusted?.includes("フォルダ一覧が想定より少ないため"),
      true,
    );

    const secretOnly = buildOneDriveNightlyNotification(
      {
        retry: retry(),
        folderUrl: fu({}),
        secret: evaluateGraphSecretExpiry(new Date("2026-08-17T17:00:00.000Z"), "2026-09-17"),
      },
      AT,
    );
    eq("★鍵の期限だけでも送る", secretOnly?.includes("残り30日（期限: 2026-09-17）"), true);
    eq(
      "期限が十分あるときは鍵の話を混ぜない",
      buildOneDriveNightlyNotification(
        {
          retry: retry({ success: 1, givenUp: 1 }),
          folderUrl: fu({}),
          secret: evaluateGraphSecretExpiry(new Date("2026-08-17T17:00:00.000Z"), "2028-08-17"),
        },
        AT,
      )?.includes("有効期限"),
      false,
    );

    eq(
      "機能1・2 を動かしていない（folderUrl=null）晩は既存の文面のまま",
      buildOneDriveNightlyNotification(
        { retry: retry({ success: 3, givenUp: 1 }), folderUrl: null, secret: null },
        AT,
      )?.includes("何度試してもコピーできなかった書類: 1件"),
      true,
    );

    const aborted = buildOneDriveNightlyNotification(
      { retry: retry(), folderUrl: fu({ abortedReason: "ONEDRIVE_OWNER_UPN が未設定です" }), secret: null },
      AT,
    );
    eq("設定不備で中止した晩も知らせる", aborted?.includes("自動確認ができませんでした"), true);
  }

  console.log(`\n===== 結果: ${passed} passed / ${failed} failed =====\n`);
  process.exit(failed === 0 ? 0 : 1);
}

export {};
