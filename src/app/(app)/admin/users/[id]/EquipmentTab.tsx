"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import type { EquipmentData } from "./detail-types";
import { patchEmployeeSection } from "./detail-types";
import { FormField, TextInput, DateInput, SaveBar, BlockTitle } from "./detail-ui";

// T-096 タブ5: 貸与物。パスワード類5項目はマスク表示:
// - 初期表示は値の有無のみ（値あり=●●●●●●＋「表示」、値なし=「未設定」）
// - 「表示」クリック時のみ /secrets API で復号値を取得（初期 props には復号値を含めない）
// - 変更は平文入力 → 保存 API がサーバ側で暗号化

type SecretField =
  | "pcInitialPassword"
  | "lineworksPassword"
  | "appleIdPassword"
  | "googlePassword"
  | "office365Password";

function PasswordField({
  employeeId,
  field,
  label,
  hasValue,
  newValue,
  onChangeNew,
}: {
  employeeId: string;
  field: SecretField;
  label: string;
  hasValue: boolean;
  newValue: string;
  onChangeNew: (v: string) => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleReveal = async () => {
    if (revealed !== null) {
      setRevealed(null); // 再クリックで再マスク
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/employees/${employeeId}/secrets?field=${field}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `エラー ${res.status}`);
        return;
      }
      const j = await res.json();
      setRevealed(j.value ?? "");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex items-center gap-2 mb-1.5">
        {hasValue ? (
          <>
            <span className="font-mono text-sm text-slate-700">
              {revealed !== null ? revealed : "●●●●●●"}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={toggleReveal}
              className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              {loading ? "..." : revealed !== null ? "隠す" : "表示"}
            </button>
          </>
        ) : (
          <span className="text-sm text-slate-400">未設定</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <input
        type="text"
        value={newValue}
        onChange={(e) => onChangeNew(e.target.value)}
        placeholder={hasValue ? "変更する場合のみ入力" : "設定する場合は入力"}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

export default function EquipmentTab({
  employeeId,
  equipment,
}: {
  employeeId: string;
  equipment: EquipmentData | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    pcLentDate: equipment?.pcLentDate ?? "",
    pcNumber: equipment?.pcNumber ?? "",
    pcType: equipment?.pcType ?? "",
    deviceNumber: equipment?.deviceNumber ?? "",
    mobileNumber: equipment?.mobileNumber ?? "",
    mobileSerialNumber: equipment?.mobileSerialNumber ?? "",
    appleId: equipment?.appleId ?? "",
    googleAccount: equipment?.googleAccount ?? "",
    mobileManagementNo: equipment?.mobileManagementNo ?? "",
  });
  // パスワード類の新規入力値（空 = 変更しない）
  const [secrets, setSecrets] = useState<Record<SecretField, string>>({
    pcInitialPassword: "",
    lineworksPassword: "",
    appleIdPassword: "",
    googlePassword: "",
    office365Password: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  };
  const setSecret = (key: SecretField) => (v: string) => {
    setSecrets((s) => ({ ...s, [key]: v }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // 空のパスワード入力は送らない（=変更しない）。入力された項目のみ平文で送信し、
      // サーバ側で暗号化して保存される。
      const secretPayload: Record<string, string> = {};
      for (const [k, v] of Object.entries(secrets)) {
        if (v.length > 0) secretPayload[k] = v;
      }
      await patchEmployeeSection(employeeId, "equipment", { ...form, ...secretPayload });
      setSecrets({
        pcInitialPassword: "",
        lineworksPassword: "",
        appleIdPassword: "",
        googlePassword: "",
        office365Password: "",
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardBody>
        <BlockTitle>PC</BlockTitle>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="PC貸与日">
            <DateInput value={form.pcLentDate} onChange={set("pcLentDate")} />
          </FormField>
          <FormField label="PC番号">
            <TextInput value={form.pcNumber} onChange={set("pcNumber")} />
          </FormField>
          <FormField label="PC機種">
            <TextInput value={form.pcType} onChange={set("pcType")} />
          </FormField>
          <FormField label="端末番号">
            <TextInput value={form.deviceNumber} onChange={set("deviceNumber")} />
          </FormField>
          <PasswordField
            employeeId={employeeId}
            field="pcInitialPassword"
            label="PC初期パスワード"
            hasValue={equipment?.hasPcInitialPassword ?? false}
            newValue={secrets.pcInitialPassword}
            onChangeNew={setSecret("pcInitialPassword")}
          />
          <PasswordField
            employeeId={employeeId}
            field="lineworksPassword"
            label="LINE WORKS パスワード"
            hasValue={equipment?.hasLineworksPassword ?? false}
            newValue={secrets.lineworksPassword}
            onChangeNew={setSecret("lineworksPassword")}
          />
        </div>

        <div className="mt-6">
          <BlockTitle>携帯</BlockTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="携帯番号">
              <TextInput value={form.mobileNumber} onChange={set("mobileNumber")} />
            </FormField>
            <FormField label="携帯製造番号">
              <TextInput value={form.mobileSerialNumber} onChange={set("mobileSerialNumber")} />
            </FormField>
            <FormField label="管理No">
              <TextInput value={form.mobileManagementNo} onChange={set("mobileManagementNo")} />
            </FormField>
            <FormField label="Apple ID">
              <TextInput value={form.appleId} onChange={set("appleId")} />
            </FormField>
            <PasswordField
              employeeId={employeeId}
              field="appleIdPassword"
              label="Apple ID パスワード"
              hasValue={equipment?.hasAppleIdPassword ?? false}
              newValue={secrets.appleIdPassword}
              onChangeNew={setSecret("appleIdPassword")}
            />
            <FormField label="Google アカウント">
              <TextInput value={form.googleAccount} onChange={set("googleAccount")} />
            </FormField>
            <PasswordField
              employeeId={employeeId}
              field="googlePassword"
              label="Google パスワード"
              hasValue={equipment?.hasGooglePassword ?? false}
              newValue={secrets.googlePassword}
              onChangeNew={setSecret("googlePassword")}
            />
            <PasswordField
              employeeId={employeeId}
              field="office365Password"
              label="Office365 パスワード"
              hasValue={equipment?.hasOffice365Password ?? false}
              newValue={secrets.office365Password}
              onChangeNew={setSecret("office365Password")}
            />
          </div>
        </div>

        <SaveBar saving={saving} error={error} saved={saved} onSave={handleSave} />
      </CardBody>
    </Card>
  );
}
