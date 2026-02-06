"use client";

import { useMemo, useState } from "react";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Table, TableWrap, Td, Th } from "@/components/ui/Table";
import { DUMMY_AI_JOBS, DummyAiJob } from "@/lib/dummyAiJobs";

type TabKey = "running" | "done" | "failed";

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function statusLabel(s: DummyAiJob["status"]) {
  if (s === "running") return "実行中";
  if (s === "queued") return "待機";
  if (s === "done") return "完了";
  return "失敗";
}

function statusColor(s: DummyAiJob["status"]) {
  if (s === "done") return "#16A34A";
  if (s === "failed") return "#DC2626";
  if (s === "running") return "#2563EB";
  return "#F59E0B";
}

export default function AiJobsPage() {
  const [tab, setTab] = useState<TabKey>("running");
  const [selectedId, setSelectedId] = useState<string | null>(DUMMY_AI_JOBS[0]?.id ?? null);

  const filtered = useMemo(() => {
    const jobs = DUMMY_AI_JOBS.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (tab === "running") return jobs.filter((j) => j.status === "running" || j.status === "queued");
    if (tab === "done") return jobs.filter((j) => j.status === "done");
    return jobs.filter((j) => j.status === "failed");
  }, [tab]);

  const selected = useMemo(
    () => DUMMY_AI_JOBS.find((j) => j.id === selectedId) ?? null,
    [selectedId]
  );

  return (
    <div>
      <PageTitle>AIジョブ（履歴）</PageTitle>

      {/* Tabs */}
      <div className="mt-4 flex gap-1">
        {[
          { key: "running" as const, label: "実行中" },
          { key: "done" as const, label: "完了" },
          { key: "failed" as const, label: "失敗" },
        ].map((t) => (
          <button
            key={t.key}
            className={[
              "px-6 py-2 text-[14px] border-b-2 transition-colors",
              tab === t.key
                ? "border-[#2563EB] text-[#374151] font-medium"
                : "border-transparent text-[#374151]/70 hover:text-[#374151]",
            ].join(" ")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* List */}
        <Card>
          <CardHeader title="ジョブ一覧（クリックで詳細表示）" />
          <CardBody>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>時刻</Th>
                    <Th>種類</Th>
                    <Th>対象</Th>
                    <Th>状態</Th>
                    <Th>実行者</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((j) => {
                    const isActive = j.id === selectedId;
                    return (
                      <tr
                        key={j.id}
                        className={[
                          "cursor-pointer transition-colors",
                          isActive ? "bg-[#EEF2FF]" : "hover:bg-[#F5F7FA]",
                        ].join(" ")}
                        onClick={() => setSelectedId(j.id)}
                      >
                        <Td>
                          <span className="font-mono text-[13px]">{formatTime(j.createdAt)}</span>
                        </Td>
                        <Td>{j.type}</Td>
                        <Td>
                          <span className="font-mono text-[13px]">{j.target}</span>
                        </Td>
                        <Td>
                          <span
                            className="inline-block rounded px-2 py-0.5 text-[12px] text-white"
                            style={{ backgroundColor: statusColor(j.status) }}
                          >
                            {statusLabel(j.status)}
                          </span>
                        </Td>
                        <Td>{j.actorName}</Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[14px] text-[#374151]/60">
                        データがありません（ダミー）
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>

        {/* Detail panel */}
        <Card>
          <CardHeader title="ジョブ詳細（右パネル）" />
          <CardBody>
            {selected ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[12px] text-[#374151]/70">ID:</div>
                  <div className="font-mono text-[14px]">{selected.id}</div>
                </div>

                <div>
                  <div className="text-[12px] text-[#374151]/70">種類:</div>
                  <div className="text-[14px]">{selected.type}</div>
                </div>

                <div>
                  <div className="text-[12px] text-[#374151]/70">対象:</div>
                  <div className="font-mono text-[14px]">{selected.target}</div>
                </div>

                <div>
                  <div className="text-[12px] text-[#374151]/70">進捗:</div>
                  {(selected.status === "running" || selected.status === "queued") ? (
                    <>
                      <div className="mt-1 h-2 w-full rounded bg-[#E5E7EB]">
                        <div
                          className="h-2 rounded"
                          style={{ width: `${selected.progress ?? 0}%`, backgroundColor: "#2563EB" }}
                        />
                      </div>
                      <div className="text-[12px] text-[#374151]/70 mt-1">処理中: {selected.progress ?? 0}%</div>
                    </>
                  ) : (
                    <div className="text-[14px]">{statusLabel(selected.status)}</div>
                  )}
                </div>

                <div>
                  <div className="text-[12px] text-[#374151]/70">実行者:</div>
                  <div className="text-[14px]">{selected.actorName}</div>
                </div>

                <div className="text-[12px] text-[#374151]/70">
                  {selected.summary ?? "実行中です。完了すると結果が表示されます（ダミー）。"}
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    className="flex-1 rounded-md bg-[#2563EB] px-4 py-2 text-white text-[14px] font-medium"
                    type="button"
                    onClick={() => alert("（ダミー）結果画面へ遷移します。")}
                  >
                    結果を見る
                  </button>
                  <button
                    className="flex-1 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                    type="button"
                    onClick={() => alert("（ダミー）別タブで開きます。")}
                  >
                    別タブで開く
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[14px] text-[#374151]/70">左の一覧からジョブを選択してください。</div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
