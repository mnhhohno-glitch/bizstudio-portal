# T-064 Phase 1 調査報告

## 調査1: 基本情報タブの UI 構造

### 画面構成

- **サーバーコンポーネント**: `src/app/(app)/candidates/[candidateId]/page.tsx`
- **クライアントコンポーネント**: `src/components/candidates/CandidateDetailPage.tsx`
- **ヘッダー表示**: `src/components/candidates/CandidateHeader.tsx`

### タブ構成（L98-102）

```typescript
// src/components/candidates/CandidateDetailPage.tsx L98-102
const TOP_VIEWS = [
  { key: "basic", label: "基本" },
  { key: "interview", label: "面談履歴" },
  { key: "settings-history", label: "設定履歴" },
] as const;
```

### 編集パターン: モーダル（EditModal）

基本情報の編集は **モーダル** パターン。`CandidateDetailPage.tsx` L154-363 の `EditModal` コンポーネント。

#### 状態管理（L165-180）

```typescript
// src/components/candidates/CandidateDetailPage.tsx L165-180
  const [name, setName] = useState(candidate.name);
  const [furigana, setFurigana] = useState(candidate.nameKana || "");
  const [isFuriganaComposing, setIsFuriganaComposing] = useState(false);
  const [candidateNo, setCandidateNo] = useState(candidate.candidateNumber);
  const [email, setEmail] = useState(candidate.email || "");
  const [phone, setPhone] = useState(candidate.phone || "");
  const [address, setAddress] = useState(candidate.address || "");
  const [gender, setGender] = useState(candidate.gender || "");
  const [birthday, setBirthday] = useState(candidate.birthday ? new Date(candidate.birthday).toISOString().slice(0, 10) : "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(
    candidate.employeeId || ""
  );
  const [recruiterName, setRecruiterName] = useState(candidate.recruiterName || "");
  const [applicationRoute, setApplicationRoute] = useState(candidate.applicationRoute || "");
  const [mediaSource, setMediaSource] = useState(candidate.mediaSource || "");
  const [saving, setSaving] = useState(false);
```

#### handleSave（L192-222）

```typescript
// src/components/candidates/CandidateDetailPage.tsx L192-222
  const handleSave = async () => {
    if (!name.trim() || !furigana.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateNumber: candidateNo.trim(),
          name: name.trim(),
          furigana: furigana.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim(),
          gender: gender || null,
          birthday: birthday || null,
          assignedEmployeeId: assignedEmployeeId || null,
          recruiterName: recruiterName.trim() || null,
          applicationRoute: applicationRoute || null,
          mediaSource: mediaSource || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
      onClose();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };
```

#### UI レイアウト（L244-342）

モーダル内は `grid grid-cols-2 gap-4` で2カラムレイアウト。L327-342 に「経路」「媒体」の select が並んでおり、その直後（L343 の `</div>` 前）に **希望条件セクションを追加する位置** がある。

```typescript
// src/components/candidates/CandidateDetailPage.tsx L327-342
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">経路</label>
                <select value={applicationRoute} onChange={(e) => setApplicationRoute(e.target.value)} ...>
                  <option value="">選択してください</option>
                  {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">媒体</label>
                <select value={mediaSource} onChange={(e) => setMediaSource(e.target.value)} ...>
                  <option value="">選択してください</option>
                  {MEDIA_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
```

---

## 調査2: Candidate モデル拡張の前提

### 現状 Prisma 定義（L230-279）

```prisma
// prisma/schema.prisma L230-279
model Candidate {
  id                     String    @id @default(cuid())
  candidateNumber        String    @unique @map("candidate_number")
  name                   String
  nameKana               String?   @map("name_kana")
  gender                 String? // "male" | "female" | "other"
  email                  String?
  phone                  String?
  address                String?
  birthday               DateTime?
  supportStatus          String    @default("BEFORE") @map("support_status")
  supportSubStatus       String?   @map("support_sub_status")
  supportSubStatusManual Boolean   @default(false) @map("support_sub_status_manual")
  supportEndReason       String?   @map("support_end_reason")
  supportEndNote         String?   @map("support_end_note")
  supportEndDate         DateTime? @map("support_end_date")
  supportEndComment      String?   @map("support_end_comment") @db.Text

  employeeId String?   @map("employee_id")
  employee   Employee? @relation(fields: [employeeId], references: [id])

  recruiterName    String? @map("recruiter_name")
  applicationRoute String? @map("application_route")
  mediaSource      String? @map("media_source")

  // ... relations ...

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("candidates")
}
```

### マイグレーション命名規則

最新4件:
1. `20260516000000_add_mynavi_rpa_models`
2. `20260517000000_add_recruiter_name_to_candidate`
3. `20260517010000_add_application_route_and_media_source_to_candidate`
4. `20260520000000_add_bs_document_folder`（最新）

命名パターン: `YYYYMMDDHHMMSS_descriptive_name_in_snake_case`

最新マイグレーション SQL（`20260520000000`）:
```sql
-- AlterTable
ALTER TABLE "candidate_files" ADD COLUMN "folder_id" TEXT;
```

nullable カラム追加は `ADD COLUMN` のみで backwards-compatible。

### enum 運用パターン

Prisma enum は `CandidateFileCategory` 等で使用。ただし Candidate モデルの `gender`、`supportStatus`、`applicationRoute`、`mediaSource` は **全て `String?`** で定義されており、アプリ側定数で値を制約している。

**結論**: 希望条件カラムも `String?` + `Int?` で追加するのが既存パターンに合致。Prisma enum は不要。

---

## 調査3: 既存定数定義の有無

| 項目 | 既存定義 | パス | 詳細 |
|--|--|--|--|
| 都道府県 | **あり** | `src/lib/constants/prefectures.ts` | `REGIONS` 配列（8地域×都道府県リスト） |
| 雇用形態 | **散在（集約定義なし）** | AI プロンプト内 / InterviewForm / tasks/new | 最も包括的なリストは AI プロンプト内: 正社員/契約社員/派遣社員/パート・アルバイト/業務委託/その他 |
| 職種・業種 | **DB 駆動（定数なし）** | `src/app/api/job-categories/` / `src/app/api/industry-categories/` | 3階層マスタ（大分類→中分類→小分類）、DB に格納 |

### 都道府県定数（`src/lib/constants/prefectures.ts` 全文）

```typescript
export const REGIONS = [
  { name: "北海道・東北", prefectures: ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { name: "関東", prefectures: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "山梨県"] },
  { name: "北信越", prefectures: ["新潟県", "富山県", "石川県", "福井県", "長野県"] },
  { name: "東海", prefectures: ["岐阜県", "静岡県", "愛知県", "三重県"] },
  { name: "関西", prefectures: ["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"] },
  { name: "中国・四国", prefectures: ["鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県"] },
  { name: "九州・沖縄", prefectures: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] },
  { name: "海外", prefectures: ["海外"] },
];
```

---

## 調査4: AI 抽出結果保存の修正対象箇所

| 経路 | ファイル | 修正対象行 | 内容 |
|--|--|--|--|
| 解析API | `src/app/api/candidates/parse-resume/route.ts` | L116-124 | **修正不要**: 既に desiredXxx を戻り値に含んでいる |
| gemini-resume-parser | `src/lib/gemini-resume-parser.ts` | L38-44, L136-148 | **修正不要**: 既にプロンプト・型・戻り値に desiredXxx を含む |
| RPA API | `src/app/api/rpa/mynavi/pdf-upload/route.ts` | L187-199 | `prisma.candidate.create()` の data に desiredXxx を追加 |
| 手動API | `src/app/api/master/candidates/route.ts` | L142-157 | `prisma.candidate.create()` の data に desiredXxx を追加 + zod スキーマ（L73-88）に追加 |
| 手動UI (解析後) | `CandidateRegistrationModal.tsx` | L124-133 | handleParseResume に `setDesiredXxx(data.desiredXxx)` 追加 |
| 手動UI (送信) | `CandidateRegistrationModal.tsx` | L168-181 | handleSubmit の JSON body に desiredXxx を追加 |
| 編集モーダル (状態) | `CandidateDetailPage.tsx` | L165-180 | EditModal に `desiredXxx` state 追加 |
| 編集モーダル (送信) | `CandidateDetailPage.tsx` | L199-212 | handleSave の JSON body に desiredXxx を追加 |
| 編集モーダル (UI) | `CandidateDetailPage.tsx` | L327-342付近 | 希望条件フィールドの input/select を追加 |
| 編集API | `update/route.ts` | L31-94 | body.desiredXxx の処理を追加 |

### RPA API の修正対象行（L187-199）

```typescript
// src/app/api/rpa/mynavi/pdf-upload/route.ts L187-199
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: parsed.name,
        ...(parsed.nameKana ? { nameKana: parsed.nameKana } : {}),
        ...(parsed.gender ? { gender: parsed.gender } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(phoneNormalized ? { phone: phoneNormalized } : {}),
        ...(parsed.address ? { address: parsed.address } : {}),
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        birthday: parsed.birthDate,
        // ← ここに desiredXxx を追加
      },
    });
```

### 手動登録 API の修正対象行（L142-157）

```typescript
// src/app/api/master/candidates/route.ts L142-157
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: formattedName,
        nameKana: nameKana.trim(),
        ...(email ? { email: email.trim() } : {}),
        ...(phone ? { phone: phone.trim() } : {}),
        ...(address ? { address: address.trim() } : {}),
        gender,
        ...(birthday ? { birthday: new Date(birthday + "T12:00:00.000Z") } : {}),
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        ...(applicationRoute?.trim() ? { applicationRoute: applicationRoute.trim() } : {}),
        ...(mediaSource?.trim() ? { mediaSource: mediaSource.trim() } : {}),
        employeeId,
        // ← ここに desiredXxx を追加
      },
    });
```

---

## 調査5: parseResumeData の拡張可能性

### 現状 `ParsedResumeFields` 型（L10-21）

```typescript
// src/lib/mynavi-rpa/parse-resume-data.ts L10-21
export type ParsedResumeFields = {
  name: string | null;
  nameKana: string | null;
  lastName: string | null;
  firstName: string | null;
  birthDate: Date | null;
  phone: string | null;
  address: string | null;
  gender: string | null;
  email: string | null;
  consultantName: string | null;
  applicationRoute: string | null;
  mediaSource: string | null;
};
```

### 拡張方法

`ParsedResumeFields` に以下を追加:

```typescript
desiredJobType1: string | null;
desiredJobType2: string | null;
desiredIndustry1: string | null;
desiredPrefecture: string | null;
desiredEmploymentType: string | null;
desiredSalaryMin: number | null;
```

`parseResumeData()` 関数内に既存の `pickString` パターンで追加:

```typescript
const desiredJobType1 = pickString(flat, ["desiredJobType1", "desired_job_type_1", "希望職種1"]);
const desiredJobType2 = pickString(flat, ["desiredJobType2", "desired_job_type_2", "希望職種2"]);
const desiredIndustry1 = pickString(flat, ["desiredIndustry1", "desired_industry_1", "希望業種"]);
const desiredPrefecture = pickString(flat, ["desiredPrefecture", "desired_prefecture", "希望勤務地"]);
const desiredEmploymentType = pickString(flat, ["desiredEmploymentType", "desired_employment_type", "希望雇用形態"]);
// desiredSalaryMin は数値型のため pickString ではなく個別処理
```

null 早期 return（L82-93）にも全フィールドを追加する必要あり。

---

## 調査6: 求職者編集 API の現状

### ファイルパス

`src/app/api/candidates/[candidateId]/update/route.ts`

### ハンドラ全文（L12-134）

```typescript
// src/app/api/candidates/[candidateId]/update/route.ts L12-134
export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;
  const existing = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });
  if (!existing) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updateData.name = normalizeSpaces(body.name.trim());
  }
  if (body.furigana !== undefined) {
    updateData.nameKana = normalizeSpaces(body.furigana.trim());
  }
  if (body.email !== undefined) { updateData.email = body.email.trim() || null; }
  if (body.phone !== undefined) { updateData.phone = body.phone.trim() || null; }
  if (body.address !== undefined) { updateData.address = body.address.trim() || null; }
  if (body.candidateNumber !== undefined) { updateData.candidateNumber = body.candidateNumber.trim(); }
  if (body.gender !== undefined) { updateData.gender = body.gender || null; }
  if (body.assignedEmployeeId !== undefined) { updateData.employeeId = body.assignedEmployeeId || null; }
  if (body.recruiterName !== undefined) { updateData.recruiterName = body.recruiterName?.trim() || null; }
  if (body.applicationRoute !== undefined) { updateData.applicationRoute = body.applicationRoute?.trim() || null; }
  if (body.mediaSource !== undefined) { updateData.mediaSource = body.mediaSource?.trim() || null; }
  if (body.birthday !== undefined) { updateData.birthday = body.birthday ? new Date(body.birthday) : null; }
  // ... supportStatus 系は省略 ...

  const updated = await prisma.candidate.update({
    where: { id: candidateId },
    data: updateData,
    include: { employee: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ candidate: updated });
}
```

### 重要な特徴

- **zod スキーマなし**: PATCH API は `body` を直接読み取り、`body.xxx !== undefined` で条件分岐。zod バリデーションは使っていない。
- **フィールド追加パターン**: `if (body.desiredXxx !== undefined) { updateData.desiredXxx = body.desiredXxx?.trim() || null; }` を追加するだけで対応可能。
- POST（新規登録）API（`src/app/api/master/candidates/route.ts`）は zod スキーマを使っている（L73-88）。こちらには `desiredXxx` を optional フィールドとして追加が必要。

---

## 調査7: 課題一覧と判定

| # | 課題 | 判定 | 理由 |
|--|--|--|--|
| 1 | **Prisma migration の backwards-compatibility** | 今Phase同梱 | 全6カラム nullable（`String?` / `Int?`）で追加すれば既存レコード・既存 API に影響なし。pdf-upload API は migration 中も停止しない |
| 2 | **雇用形態の定数定義が散在** | 今Phase同梱 | `src/lib/constants/employment-types.ts` を新設し、AI プロンプト・UI select で共有する |
| 3 | **CandidateHeader.tsx への表示追加** | 今Phase同梱 | EditModal だけでなく、ヘッダーにも希望条件のサマリーを表示する必要がある（閲覧用） |
| 4 | **手動登録モーダル（CandidateRegistrationModal）への入力フィールド追加** | 今Phase同梱 | AI 解析結果の自動入力だけでなく、CA が手動で希望条件を入力するフィールドも必要 |
| 5 | **parse-resume API と gemini-resume-parser.ts のプロンプト二重定義** | 後Phase送り | リファクタ案件。動作に影響なし。本タスクでは触らない |
| 6 | **職種・業種フィールドの入力方式** | 今Phase同梱 | 職種・業種は DB マスタ（3階層）だが、AI 抽出値はフリーテキスト。UI は freetext input で実装し、マスタ連携は別タスク |
| 7 | **desiredSalaryMin の型（Int vs String）** | 今Phase同梱 | AI は整数で返す。DB は `Int?` で保存。UI は number input。「応相談」等のフリーテキストは不要（業務要件で確定済み） |
| 8 | **既存求職者のデータ遡及** | 不要 | 業務要件で「新規登録分のみ対応」と確定済み |
| 9 | **マッチング画面での活用** | 別タスク化 | 業務要件で「本タスク対象外」と確定済み |
| 10 | **parseResumeData に desiredXxx がない** | 今Phase同梱 | RPA 経路で AI 抽出結果を Candidate に保存するために型・関数の拡張が必要 |

---

## Phase 2/3 で確定すべき仕様の論点

### 確定済み（調査結果から自明）

1. **DB カラム型**: 全て `String?`（desiredSalaryMin のみ `Int?`）。Prisma enum 不使用（既存パターン準拠）
2. **DB カラム名**: `desired_job_type_1`, `desired_job_type_2`, `desired_industry_1`, `desired_prefecture`, `desired_employment_type`, `desired_salary_min`（snake_case `@map`）
3. **Migration**: `ALTER TABLE candidates ADD COLUMN xxx` × 6。backwards-compatible
4. **PATCH API**: `if (body.desiredXxx !== undefined)` パターンで追加（zod 不要、既存パターン準拠）
5. **POST API**: zod スキーマに optional フィールドとして追加

### Phase 2/3 実装時に決定すべき

1. **EditModal 内の UI 配置**: L342 付近（経路・媒体の下）に「希望条件」セクションを追加。レイアウトは 2カラム grid（既存パターン準拠）
2. **CandidateHeader への表示**: ヘッダーのどの位置に表示するか（Row 2 の連絡先の下 or 新しい Row）
3. **都道府県 select の実装**: `REGIONS` 定数を使って `<select>` + `<optgroup>` で実装するか、フリーテキスト input にするか
4. **雇用形態 select の選択肢**: AI プロンプトの6値（正社員/契約社員/派遣社員/パート・アルバイト/業務委託/その他）で確定するか
5. **CandidateRegistrationModal にも希望条件入力欄を追加するか**: 現状は AI 解析結果の自動入力のみだが、手動入力欄も追加するか

### 修正ファイル一覧（Phase 3 実装スコープ）

| # | ファイル | 修正内容 |
|--|--|--|
| 1 | `prisma/schema.prisma` | Candidate モデルに 6 カラム追加 |
| 2 | `prisma/migrations/新規/migration.sql` | ALTER TABLE × 6 |
| 3 | `src/lib/mynavi-rpa/parse-resume-data.ts` | ParsedResumeFields 型 + parseResumeData 関数に 6 フィールド追加 |
| 4 | `src/app/api/rpa/mynavi/pdf-upload/route.ts` | prisma.candidate.create() に desiredXxx 追加 |
| 5 | `src/app/api/master/candidates/route.ts` | zod スキーマ + prisma.candidate.create() に desiredXxx 追加 |
| 6 | `src/app/api/candidates/[candidateId]/update/route.ts` | body.desiredXxx 処理を追加 |
| 7 | `src/components/candidates/CandidateDetailPage.tsx` | EditModal に state + input + handleSave body 追加 |
| 8 | `src/components/candidates/CandidateHeader.tsx` | 希望条件の表示を追加 |
| 9 | `src/app/(app)/admin/master/CandidateRegistrationModal.tsx` | handleParseResume + handleSubmit に desiredXxx 追加 |
| 10 | `src/lib/constants/employment-types.ts` | 新規作成（雇用形態定数） |
