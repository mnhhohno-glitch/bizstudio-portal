import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeFieldLabels } from "@/lib/training-work";

// 自分の記述ワーク回答を通して読み返すための読み取り専用画面。
// サーバーコンポーネントでセッションの employeeId のみを条件に引くため、他人の回答は取得しない
export default async function TrainingWorkReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ workKey?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { workKey: requested } = await searchParams;

  const sets = await prisma.trainingWorkSet.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { workKey: true, title: true, fieldLabels: true },
  });
  const current = sets.find((s) => s.workKey === requested) ?? sets[0] ?? null;
  const fields = current ? normalizeFieldLabels(current.fieldLabels) : [];

  const [items, answers] = current
    ? await Promise.all([
        prisma.trainingWorkItem.findMany({
          where: { workKey: current.workKey, isActive: true },
          orderBy: { sortOrder: "asc" },
          select: { itemCode: true, title: true },
        }),
        prisma.trainingWorkAnswer.findMany({
          where: { workKey: current.workKey, employeeId: user.id },
          select: {
            itemCode: true,
            answerCompany: true,
            answerHelp: true,
            answerDay: true,
            answerUnknown: true,
            updatedAt: true,
          },
        }),
      ])
    : [[], []];

  const answerByCode = new Map(answers.map((a) => [a.itemCode, a]));
  const answeredCount = items.filter((i) => answerByCode.has(i.itemCode)).length;

  // 罠#17: Railway 本番は UTC で動くため、日時表示は必ず JST を明示する
  const formatJst = (d: Date) =>
    `${d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replaceAll("-", "/")} ${d.toLocaleTimeString(
      "ja-JP",
      { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }
    )}`;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[20px] font-semibold text-[#374151]">記述ワーク：自分の回答</h1>
        <Link href="/training/work" className="text-[13px] text-[#2563EB] hover:underline">
          ← 入力画面に戻る
        </Link>
      </div>

      {/* ワーク選択 */}
      {sets.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {sets.map((s) => {
            const active = s.workKey === current?.workKey;
            return (
              <Link
                key={s.workKey}
                href={`/training/work/review?workKey=${encodeURIComponent(s.workKey)}`}
                className={[
                  "px-3 py-1.5 text-[13px] rounded-md border transition-colors",
                  active
                    ? "bg-[#2563EB] text-white border-[#2563EB] font-medium"
                    : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]",
                ].join(" ")}
              >
                {s.title}
              </Link>
            );
          })}
        </div>
      )}

      {!current ? (
        <p className="py-12 text-center text-[14px] text-[#6B7280]">ワークが登録されていません</p>
      ) : (
        <>
          <p className="mt-3 text-[14px] text-[#374151]">
            {items.length}件中 {answeredCount}件 回答済み
            <span className="ml-2 text-[13px] text-[#6B7280]">
              （この画面は読み取り専用です。書き直しは入力画面から）
            </span>
          </p>

          {items.length === 0 ? (
            <p className="py-12 text-center text-[14px] text-[#6B7280]">設問が登録されていません</p>
          ) : (
            <div className="mt-4 space-y-3 pb-10">
              {items.map((item) => {
                const a = answerByCode.get(item.itemCode);
                return (
                  <div
                    key={item.itemCode}
                    className="bg-white rounded-[8px] border border-[#E5E7EB] p-4"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB] text-[12px] font-semibold">
                        {item.itemCode}
                      </span>
                      <h2 className="text-[14px] font-medium text-[#374151]">{item.title}</h2>
                      {a ? (
                        <span className="ml-auto text-[12px] text-[#6B7280]">
                          保存: {formatJst(a.updatedAt)}
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[12px]">
                          未回答
                        </span>
                      )}
                    </div>

                    {a && (
                      <dl className="mt-3 space-y-2">
                        {fields.map((f) => (
                          <div key={f.key}>
                            <dt className="text-[12px] font-medium text-[#6B7280]">{f.label}</dt>
                            <dd className="text-[14px] text-[#374151] whitespace-pre-wrap">
                              {a[f.key] || <span className="text-[#9CA3AF]">（未記入）</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
