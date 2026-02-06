import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { DUMMY_JOBS, Job } from "@/lib/dummyJobs";

// 都道府県を抽出する簡易関数
function extractPrefecture(location: string): string {
  const prefectures = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
  ];
  for (const pref of prefectures) {
    if (location.includes(pref)) return pref;
  }
  // 都/府/県なしで検索
  for (const pref of prefectures) {
    const short = pref.replace(/[都府県]$/, "");
    if (location.includes(short)) return pref;
  }
  return location;
}

// 求人種別を推定（ダミー実装）
function inferJobType(job: Job): string {
  const title = job.job_title.toLowerCase();
  if (title.includes("エンジニア") || title.includes("開発")) return "エンジニア";
  if (title.includes("コンサル")) return "コンサルタント";
  if (title.includes("営業")) return "営業";
  if (title.includes("マネージャー") || title.includes("マネジメント")) return "管理職";
  return "その他";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobIds } = body as { jobIds: string[] };

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: "jobIds is required" }, { status: 400 });
    }

    // 指定されたIDの求人を取得
    const jobs = DUMMY_JOBS.filter((j) => jobIds.includes(j.id));

    if (jobs.length === 0) {
      return NextResponse.json({ error: "No jobs found" }, { status: 404 });
    }

    // Excel用データを作成（1求人=1行）
    const rows = jobs.map((job) => ({
      求人ID: job.id,
      都道府県: extractPrefecture(job.location),
      求人DB: job.job_db,
      会社名: job.company_name,
      求人タイトル: job.job_title,
      求人種別: inferJobType(job),
    }));

    // ワークブック作成
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "求人一覧");

    // 列幅を設定
    ws["!cols"] = [
      { wch: 12 }, // 求人ID
      { wch: 10 }, // 都道府県
      { wch: 15 }, // 求人DB
      { wch: 30 }, // 会社名
      { wch: 40 }, // 求人タイトル
      { wch: 12 }, // 求人種別
    ];

    // バッファとして出力
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="jobs_export.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Excel export error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
