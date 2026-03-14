"use client";

import { useState } from "react";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";
import LineworksIdButton from "./LineworksIdButton";
import ManusKeyButton from "./ManusKeyButton";
import UserStatusButton from "./UserStatusButton";

type UserData = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  employeeNumber: number | null;
  lineworksId: string | null;
  manusApiKeyEncrypted: boolean;
  manusLast4: string | null;
  manusSetAt: string | null;
};

export default function UserListClient({ users }: { users: UserData[] }) {
  const [showDisabled, setShowDisabled] = useState(false);

  const filtered = showDisabled ? users : users.filter((u) => u.status === "active");

  return (
    <div>
      <div className="mb-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
            className="h-4 w-4 accent-[#2563EB]"
          />
          無効な社員を表示
        </label>
      </div>

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>社員番号</Th>
              <Th>名前</Th>
              <Th>メール</Th>
              <Th>権限</Th>
              <Th>LINE WORKS ID</Th>
              <Th>Manus連携</Th>
              <Th>状態</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={u.status === "disabled" ? "opacity-50" : ""}>
                <Td>
                  <span className="font-mono text-[13px]">
                    {u.employeeNumber != null ? `BS${u.employeeNumber}` : <span className="text-[#9CA3AF]">-</span>}
                  </span>
                </Td>
                <Td>{u.name}</Td>
                <Td><span className="font-mono">{u.email}</span></Td>
                <Td>{u.role}</Td>
                <Td>
                  <span className="font-mono text-xs">
                    {u.lineworksId || <span className="text-[#6B7280]/60">未設定</span>}
                  </span>
                </Td>
                <Td>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
                      u.manusApiKeyEncrypted
                        ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
                        : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
                    }`}
                  >
                    {u.manusApiKeyEncrypted ? "設定済み" : "未設定"}
                  </span>
                </Td>
                <Td>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
                      u.status === "active"
                        ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
                        : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
                    }`}
                  >
                    {u.status}
                  </span>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <LineworksIdButton
                      userId={u.id}
                      userName={u.name}
                      currentId={u.lineworksId}
                    />
                    <ManusKeyButton
                      userId={u.id}
                      userName={u.name}
                      hasKey={u.manusApiKeyEncrypted}
                      last4={u.manusLast4}
                      setAt={u.manusSetAt}
                    />
                    <UserStatusButton
                      userId={u.id}
                      email={u.email}
                      currentStatus={u.status as "active" | "disabled"}
                    />
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <Td>
                  <span className="text-[#374151]/60">社員がいません</span>
                </Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
                <Td></Td>
              </tr>
            )}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}
