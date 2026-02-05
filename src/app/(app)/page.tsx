import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";

export default async function DashboardPage() {
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";

  return (
    <div>
      <PageTitle>ダッシュボード</PageTitle>
      <PageSubtleText>
        ここが「機関システム」の入口です。今後、システムカードやお知らせを表示します。
      </PageSubtleText>

      {/* 統計カード */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">本日の登録数</div>
            <div className="mt-1 text-[32px] font-bold text-[#16A34A]">24<span className="ml-1 text-[14px] font-normal text-[#374151]">件</span></div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">未処理の申請</div>
            <div className="mt-1 text-[32px] font-bold text-[#2563EB]">5<span className="ml-1 text-[14px] font-normal text-[#374151]">件</span></div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">エラー件数</div>
            <div className="mt-1 text-[32px] font-bold text-[#DC2626]">1<span className="ml-1 text-[14px] font-normal text-[#374151]">件</span></div>
          </CardBody>
        </Card>
      </div>

      {/* お知らせとタスク */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="お知らせ" />
          <CardBody>
            <ul className="space-y-3">
              <li className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#2563EB]"></span>
                  <span className="text-[14px]">システムメンテナンスのお知らせ</span>
                  <span className="text-[12px] text-[#374151]/60">2022/10/12</span>
                </div>
                <Link href="#" className="text-[14px] text-[#2563EB] hover:underline">詳細 &gt;</Link>
              </li>
              <li className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#2563EB]"></span>
                  <span className="text-[14px]">新機能追加のお知らせ</span>
                  <span className="text-[12px] text-[#374151]/60">2022/09/28</span>
                </div>
                <Link href="#" className="text-[14px] text-[#2563EB] hover:underline">詳細 &gt;</Link>
              </li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="タスク状況" />
          <CardBody>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[14px]">対応中</span>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-32 rounded-full bg-[#E5E7EB]">
                    <div className="h-2 w-20 rounded-full bg-[#2563EB]"></div>
                  </div>
                  <span className="text-[14px] font-semibold">8<span className="ml-0.5 font-normal">件</span></span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px]">確認待ち</span>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-32 rounded-full bg-[#E5E7EB]">
                    <div className="h-2 w-10 rounded-full bg-[#6B7280]"></div>
                  </div>
                  <span className="text-[14px] font-semibold">3<span className="ml-0.5 font-normal">件</span></span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px]">完了</span>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-32 rounded-full bg-[#E5E7EB]">
                    <div className="h-2 w-32 rounded-full bg-[#16A34A]"></div>
                  </div>
                  <span className="text-[14px] font-semibold">15<span className="ml-0.5 font-normal">件</span></span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 最新の活動履歴 */}
      <div className="mt-6">
        <Card>
          <CardHeader title="最新の活動履歴" />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="min-w-full text-[14px]">
                <thead>
                  <tr className="border-b border-[#E5E7EB]">
                    <th className="pb-2 text-left text-[12px] font-semibold text-[#374151]/80">日時</th>
                    <th className="pb-2 text-left text-[12px] font-semibold text-[#374151]/80">ユーザー</th>
                    <th className="pb-2 text-left text-[12px] font-semibold text-[#374151]/80">内容</th>
                    <th className="pb-2 text-left text-[12px] font-semibold text-[#374151]/80">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#E5E7EB]">
                    <td className="py-3 font-mono text-[13px]">2022/12/01 14:30</td>
                    <td className="py-3">佐藤 一郎</td>
                    <td className="py-3">データ更新</td>
                    <td className="py-3">
                      <span className="rounded bg-[#16A34A] px-2 py-1 text-[12px] text-white">完了</span>
                    </td>
                  </tr>
                  <tr className="border-b border-[#E5E7EB]">
                    <td className="py-3 font-mono text-[13px]">2022/12/01 10:15</td>
                    <td className="py-3">鈴木 花子</td>
                    <td className="py-3">申請承認</td>
                    <td className="py-3">
                      <span className="rounded bg-[#F59E0B] px-2 py-1 text-[12px] text-white">承認待ち</span>
                    </td>
                  </tr>
                  <tr className="border-b border-[#E5E7EB]">
                    <td className="py-3 font-mono text-[13px]">2022/11/30 16:45</td>
                    <td className="py-3">田中 太郎</td>
                    <td className="py-3">エラー発生</td>
                    <td className="py-3">
                      <span className="rounded bg-[#DC2626] px-2 py-1 text-[12px] text-white">エラー</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* クイックリンク */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardBody>
            <div className="text-[15px] font-semibold text-[#374151]">システム一覧</div>
            <div className="mt-2 text-[14px] text-[#374151]/80">
              登録されたシステムへリンクで移動します。
            </div>
            <Link className="mt-3 inline-block text-[14px] text-[#2563EB] hover:underline" href="/systems">
              システム一覧へ →
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[15px] font-semibold text-[#374151]">ログイン情報</div>
            <div className="mt-2 text-[14px] text-[#374151]/80">
              {user?.name}（{user?.email}）
            </div>
            {isAdmin && (
              <div className="mt-2 text-[14px] text-[#374151]/60">
                管理者メニューが表示されています。
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
