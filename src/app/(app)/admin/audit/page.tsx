"use client";

import { useEffect, useState } from "react";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";

type LogRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actorUser: {
    email: string;
    name: string;
  };
};

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/audit");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "取得に失敗しました");
      setLogs(data.logs ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "取得に失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div>
      <PageTitle>監査ログ</PageTitle>
      <PageSubtleText>
        システム上の重要操作の履歴です（直近200件）。
      </PageSubtleText>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="ログ一覧"
            right={
              <button
                className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                onClick={fetchLogs}
                disabled={loading}
              >
                {loading ? "更新中..." : "更新"}
              </button>
            }
          />
          <CardBody>
            {error && <div className="mb-3 text-[14px] text-[#DC2626]">{error}</div>}

            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>日時</Th>
                    <Th>操作</Th>
                    <Th>対象</Th>
                    <Th>実行者</Th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <Td>
                        <span className="font-mono text-[13px]">
                          {new Date(l.createdAt).toLocaleString()}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
                            l.action.includes("SUCCESS") || l.action.includes("CREATED")
                              ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
                              : l.action.includes("FAILED")
                              ? "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]"
                              : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
                          }`}
                        >
                          {l.action}
                        </span>
                      </Td>
                      <Td>
                        <div className="text-[13px]">{l.targetType}</div>
                        {l.targetId && (
                          <div className="font-mono text-[11px] text-[#374151]/60">
                            {l.targetId}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div className="text-[13px]">{l.actorUser.name}</div>
                        <div className="font-mono text-[11px] text-[#374151]/60">
                          {l.actorUser.email}
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {!loading && logs.length === 0 && (
                    <tr>
                      <Td>
                        <span className="text-[#374151]/60">ログがありません</span>
                      </Td>
                      <Td></Td>
                      <Td></Td>
                      <Td></Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
