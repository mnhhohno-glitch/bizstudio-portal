# T-064 PDF取り込み→スカウトNO自動紐付け 調査報告書

調査日: 2026-05-25

---

## Q1: PDF取り込みの全体フロー

### エントリーポイント

`POST /api/rpa/mynavi/pdf-upload`

ファイル: `src/app/api/rpa/mynavi/pdf-upload/route.ts`

認証: `verifyRpaSecret(req)`（x-rpa-secret ヘッダ）

### フロー

```
1. RPA バッチID + PDF + recruiterName を受信
2. Gemini API で履歴書 PDF を解析 → GeminiResumeResult
3. parseResumeData() で構造化フィールドに変換
4. AI 解析失敗チェック（氏名 or 生年月日が null → AI_FAILED でリターン）
5. recruiterName 決定: リクエストパラメータ優先 → Gemini の consultantName でフォールバック
   → ScoutMachineMaster でマッチして正規化
6. 二重処理チェック（同一電話番号が直近30分以内にあれば DUPLICATE_SKIP）
7. 送信可否判定: 年齢NG / 外国籍NG
8. Candidate 新規作成（name, phone, birthday, recruiterName, applicationRoute="スカウト", mediaSource="マイナビ転職", etc.）
9. PDF を Google Drive にアップロード → CandidateFile 登録
10. MynaviRpaProcessingLog 作成
11. recalculateSubStatusIfAuto() 呼び出し
12. レスポンス返却
```

### 処理コード全文の重要部分（L201–L226: Candidate 作成）

```typescript
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
    ...(parsed.desiredJobType1 ? { desiredJobType1: parsed.desiredJobType1 } : {}),
    // ... (希望条件省略)
  },
});
```

**注目点**:
- `recruiterName` は Candidate に保存される（ScoutMachineMaster で正規化済）
- `applicationRoute` は固定 `"スカウト"`
- `scoutDeliverySlotId` の設定は**一切ない**
- `scoutNumber` の設定は**一切ない**
- `scoutLinkedAt` の設定は**一切ない**

---

## Q2: Gemini プロンプトでスカウト関連項目を抽出しているか

### Gemini プロンプト（`src/lib/gemini-resume-parser.ts` L30–L61）

```
## 抽出項目（個人情報）
- name / furigana / gender / birthday / email / phone / address

## 抽出項目（希望条件）
- desiredJobType1 / desiredJobType2 / desiredIndustry1 / desiredIndustry2
- desiredPrefecture1 / desiredPrefecture2 / desiredEmploymentType / desiredSalaryMin

## 抽出項目（応募情報）
- consultantName: コンサルタント名（スカウト配信者の氏名、例「藤本なつみ」）
- applicationRoute: 応募経路
- mediaSource: 媒体名
```

### GeminiResumeResult 型定義（L9–L28）

```typescript
export type GeminiResumeResult = {
  name: string | null;
  furigana: string | null;
  gender: string | null;
  birthday: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  desiredJobType1: string | null;
  desiredJobType2: string | null;
  desiredIndustry1: string | null;
  desiredIndustry2: string | null;
  desiredPrefecture1: string | null;
  desiredPrefecture2: string | null;
  desiredEmploymentType: string | null;
  desiredSalaryMin: number | null;
  consultantName: string | null;
  applicationRoute: string | null;
  mediaSource: string | null;
};
```

### 判定

**スカウト関連で抽出しているもの**:
- `consultantName`（コンサルタント名 = スカウト配信者名）— 抽出している

**スカウト関連で抽出していないもの**:
- 応募日 — 抽出していない
- スカウト送信日 — 抽出していない
- スカウトNO — 抽出していない（Gemini プロンプトに指示なし、型定義にもフィールドなし）

---

## Q3: PDF取り込み後の自動紐付け処理の有無

### grep 結果

```
grep -r "scoutDeliverySlotId" src/app/api/candidates/ src/lib/
→ 0 件（candidates API 内にはヒットなし）

grep -r "scoutLinkedAt" src/app/api/candidates/ src/lib/
→ 0 件

grep -r "linkScoutSlot" src/app/api/ src/lib/
→ 0 件

grep -r "linkScout" src/app/api/ src/lib/
→ src/app/api/scout/candidates/link/route.ts のみ
```

### pdf-upload route.ts 内での scout 関連処理

pdf-upload route の処理フロー全体を確認した結果:

- `scoutDeliverySlotId` への書き込みは**存在しない**
- `scoutLinkedAt` への書き込みは**存在しない**
- `scoutNumber` への書き込みは**存在しない**
- PDF取り込み後に `/api/scout/candidates/link` を呼ぶ処理は**存在しない**
- ScoutDeliverySlot テーブルへの参照・書き込みは**一切ない**

### 判定

**PDF取り込み後の自動紐付け処理は存在しない。**

唯一の紐付けパスは `POST /api/scout/candidates/link`（社員が UI から手動操作）のみ。

---

## Q4: 既存の手動紐付け API のロジック

`src/app/api/scout/candidates/link/route.ts` 全文:

```typescript
/**
 * POST /api/scout/candidates/link
 *   body: { candidateId, scoutNumber }
 *   応募者にスカウト配信枠を紐付ける
 *
 * DELETE /api/scout/candidates/link?candidateId=xxx
 *   紐付け解除
 */

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await req.json();
  const candidateId = String(body?.candidateId || "").trim();
  const scoutNumber = String(body?.scoutNumber || "").trim();

  // バリデーション
  if (!candidateId) → 400
  if (!isValidScoutNumberFormat(scoutNumber)) → 400

  // スカウト番号で配信枠を検索
  const slot = await prisma.scoutDeliverySlot.findUnique({
    where: { scoutNumber },
  });
  if (!slot) → 404

  // Candidate に紐付け
  const candidate = await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      scoutDeliverySlotId: slot.id,
      scoutNumber,
      scoutLinkedAt: new Date(),
      scoutLinkedById: user.id,
    },
  });

  return NextResponse.json({ candidate, slot });
}

export async function DELETE(req: NextRequest) {
  // candidateId で紐付け解除（scoutDeliverySlotId / scoutLinkedAt / scoutLinkedById を null に）
}
```

### 分析

**受け取るパラメータ**: `candidateId` + `scoutNumber`（SC + 8桁数字）

**検索ロジック**: scoutNumber で `findUnique` — 応募日・担当者でのマッチングは**行っていない**。社員がスカウトNOを目視確認し、手動で入力する前提。

**紐付け処理**: Candidate テーブルに以下を書き込む:
- `scoutDeliverySlotId`: slot.id
- `scoutNumber`: 入力されたスカウトNO
- `scoutLinkedAt`: 現在時刻
- `scoutLinkedById`: 操作した社員の user.id

**複数候補の処理**: なし（scoutNumber が unique なので1件しかヒットしない）

---

## Q5: 求職者詳細画面でのスカウトNO表示

### CandidateDetailPage.tsx での表示

```typescript
// L87-88: props 型定義
scoutDeliverySlotId: string | null;
scoutLinkedAt: string | null;
scoutNumber: string | null;

// L194: state 初期化
const [scoutNumber, setScoutNumber] = useState(candidate.scoutNumber || "");

// L237: 保存時に送信
scoutNumber: scoutNumber.trim() || null,

// L365-366: 表示（テキスト入力フィールド）
<label>スカウトNO</label>
<input type="text" value={scoutNumber} onChange={(e) => setScoutNumber(e.target.value)} />
```

### ScoutLinkPanel での表示（applicationRoute === "スカウト" の時のみ表示）

```typescript
// L1888-1897: CandidateDetailPage 内で呼び出し
<ScoutLinkPanel
  candidateId={candidate.id}
  applicationRoute={candidate.applicationRoute}
  currentScoutNumber={candidate.scoutNumber}
  recruiterName={candidate.recruiterName}
  scoutDeliverySlotId={candidate.scoutDeliverySlotId}
  onLinked={fetchCandidate}
/>
```

ScoutLinkPanel は `applicationRoute === "スカウト"` の場合のみ表示される（L139: `if (applicationRoute !== "スカウト") return null;`）。

パネル内容:
- スカウトNO入力フィールド（手入力 or 候補選択）
- 「紐付け」ボタン → `POST /api/scout/candidates/link` を呼ぶ
- 担当者ベースの候補補完（過去3日分の同 recruiterName 配信枠を表示）
- 紐付け済みの場合: 配信日・時間・担当・検索条件・媒体を表示

### 判定

- スカウトNO は `Candidate.scoutNumber` フィールドから表示（自由テキスト入力）
- 配信枠との紐付けは `ScoutLinkPanel` から手動で `POST /api/scout/candidates/link` を呼ぶ
- **自動表示ではない。社員が手動でスカウトNOを入力し、手動で「紐付け」ボタンを押す必要がある。**

---

## Q6: 既読数の集計ロジック

### openCount（開封数）

ScoutDeliverySlot の `openCount` カラムは以下で更新される:

#### `POST /api/scout/open-count`（手動一括更新）

```typescript
const updates = body.updates;
for (const u of updates) {
  await prisma.scoutDeliverySlot.update({
    where: { id: u.id },
    data: { openCount: parseInt(String(u.openCount ?? 0), 10) || 0 },
  });
}
```

セッション認証。社員が UI から数値を入力して一括保存する仕組み。

#### `PATCH /api/scout/slots`

```typescript
if (body.openCount !== undefined)
  data.openCount = parseInt(String(body.openCount), 10) || 0;
```

個別更新。

### applyCount（応募数）

**ScoutDeliverySlot に `applicationCount` カラムは存在しない。**

代わりに、集計 API `GET /api/scout/stats` で `linkedCandidates.length` をリアルタイム集計している:

```typescript
// src/app/api/scout/stats/route.ts L61
include: { machine: true, linkedCandidates: { select: { id: true, createdAt: true } } },

// L94
b.applyCount += slot.linkedCandidates.length;
```

つまり、Candidate テーブルの `scoutDeliverySlotId` で紐付いた候補者数を集計時にカウントしている。カウンターカラムは持たず、JOIN ベースのリアルタイム集計。

### deliveryCount（配信数）

配信数は以下から更新:
- `POST /api/scout/import/daily-excel` — OneDrive エクセルから RPA 自動取込
- `POST /api/scout/import/daily-excel-base64` — Base64 JSON 経由
- `POST /api/scout/import/aggregated` — PAD 集計済み JSON
- `PATCH /api/scout/slots` — 手動更新
- `POST /api/scout/import/filemaker-legacy` — FM過去データ取込

### 判定

- `openCount`（開封数）: 手動入力のみ（`POST /api/scout/open-count` or `PATCH /api/scout/slots`）。PDF取り込み時の自動カウントアップは**存在しない**。
- `applyCount`（応募数）: カラムとして保持せず、`linkedCandidates.length` でリアルタイム集計。紐付けが自動化されていないため、手動紐付けしないと集計に反映されない。

---

## サマリ

### 自動運用に向けて動いている機能

1. **配信レコード自動作成**: `createDailySlots()` で翌日分を毎日自動作成（Cloud Flow 1 経由）
2. **スカウトNO自動発番**: `ScoutSequence` カウンタ + `generateScoutNumber()` で連番管理
3. **担当者名の正規化**: PDF取り込み時に `ScoutMachineMaster` で recruiterName をマッチング・正規化
4. **consultantName のAI抽出**: Gemini プロンプトでPDFから「コンサルタント名」を抽出し、Candidate.recruiterName に保存
5. **applicationRoute = "スカウト" の自動設定**: マイナビRPA経由の応募は固定で "スカウト" を設定
6. **応募数のリアルタイム集計**: `linkedCandidates.length` で紐付け済み件数を集計

### 自動運用に向けて不足している機能

1. **PDF取り込み時のスカウトNO自動紐付け**: pdf-upload route に `scoutDeliverySlotId` の設定処理がない
2. **応募日のAI抽出**: Gemini プロンプトに応募日の抽出指示がない（スカウト送信日も同様）
3. **配信枠の自動検索（応募日 + 担当者 → ScoutDeliverySlot の特定）**: 実装が存在しない
4. **開封数の自動カウント**: PDF取り込み時に openCount を +1 する処理がない
5. **mynaviScoutSentAt の活用**: schema に `mynavi_scout_sent_at DateTime?` カラムがあるが、書き込み処理はどこにも存在しない

### 既存実装で流用できる部分

1. **`POST /api/scout/candidates/link` の紐付けロジック**: scoutNumber → findUnique → Candidate.update の流れは自動紐付けでも流用可能。ただし自動版ではセッション認証の代わりにシステム認証（RPA secret）が必要
2. **`ScoutLinkPanel` の候補検索**: recruiterName ベースで過去日の配信枠を検索するロジック（自動化のヒント）
3. **`ScoutMachineMaster` による recruiterName 正規化**: 既に pdf-upload で実行済み
4. **`linkedCandidates.length` の集計方式**: 紐付けさえ自動化すれば、応募数集計は追加実装なしで動く

### 新規実装が必要な部分

| # | 実装内容 | 難易度 |
|--|--|--|
| 1 | pdf-upload route に自動紐付けロジック追加 | 中 |
| 2 | 紐付けアルゴリズム: Candidate.recruiterName + Candidate.createdAt → 同日 or 前日の同担当者 ScoutDeliverySlot を検索 | 中 |
| 3 | 複数候補があった場合の優先順位（時間帯の近いもの or deliveryCount が最大のもの） | 小 |
| 4 | openCount の自動インクリメント（紐付け時に +1 するかどうかは要件確認が必要） | 小 |
| 5 | Gemini プロンプトに「応募日」「スカウト送信日」の抽出追加（任意。createdAt で代替可能） | 小 |
| 6 | mynaviScoutSentAt カラムの活用（Gemini で抽出した送信日を保存） | 小 |

### 自動紐付けのアルゴリズム案（実コードから導出）

```
入力:
  - Candidate.recruiterName（正規化済）
  - Candidate.createdAt（≒応募日）

処理:
  1. ScoutMachineMaster で recruiterName → machineId を取得
  2. ScoutDeliverySlot から (deliveryDate = createdAtの日付, machineId = 上記) を検索
  3. 候補が1件: そのまま紐付け
  4. 候補が複数件（ユニーク制約緩和後の個別配信 + 一斉配信等）: deliveryCount > 0 の中で hourSlot が最も近いものを選択
  5. 候補が0件: 前日で再検索（応募が翌日に処理される可能性）
  6. それでも0件: 紐付けスキップ（手動対応）
```
