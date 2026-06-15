# スカウト応募者進行状況管理 現状調査報告

調査日: 2026-05-23
対象: bizstudio-portal (master branch, commit 5995de3)

---

## 1. ScoutRecord モデルの現状

### 判定: 未実装（モデル自体が存在しない）

`prisma/schema.prisma` 全文を確認した結果、**ScoutRecord モデルは存在しない**。
"Scout" を名前に含むモデルも一切ない。

T-062 Phase 0 で追加予定だったとされるが、schema.prisma には反映されていない。

### 進行状況に関係するカラム

ScoutRecord がないため、スカウト応募者の進行状況（初回返信送信済 / 面談設定済 / 面談実施済 / キャンセル / バックレ）を**一元的に記録するテーブルは存在しない**。

### 現状の代替構造

スカウト関連の情報は以下に散在:

| テーブル | 保持する情報 | 制約 |
|--|--|--|
| `Candidate.applicationRoute` | "スカウト" / "応募" | 経路の識別のみ。進行ステージは不明 |
| `Candidate.mediaSource` | "マイナビ転職" 等 | 媒体名のみ |
| `Candidate.recruiterName` | スカウト配信者名 | 人物名のみ |
| `MynaviRpaProcessingLog` | AI解析・判定結果 | RPA取込バッチの処理記録。進行管理ではない |
| `CandidateSettingsHistory` | 初回返信の送信日時・結果 | sendType="MYNAVI_FIRST_REPLY" のみ記録 |
| `InterviewRecord` | 面談日時・内容・結果 | 汎用面談記録。スカウト面談かどうかの区別なし |

---

## 2. Candidate.supportSubStatus の運用

### recalculateSubStatusIfAuto() 関数本文

ファイル: `src/lib/support-sub-status.ts`

```typescript
export async function recalculateSubStatusIfAuto(candidateId: string): Promise<void> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { supportStatus: true },
  });
  if (!candidate) return;
  if (candidate.supportStatus !== "ACTIVE") return;

  const next = await calculateSubStatus(candidateId);
  await prisma.candidate.update({
    where: { id: candidateId },
    data: { supportSubStatus: next },
  });
}
```

### calculateSubStatus() 自動判定ロジック

判定は JobEntry.entryFlag / personFlag / hasJoined と CandidateFile(BOOKMARK) の状態から優先順位で決定:

```
1. 入社済  ← personFlag === "入社済" || hasJoined === true
2. 内定    ← entryFlag === "内定"
3. 面接    ← entryFlag === "面接"
4. 書類選考 ← entryFlag === "書類選考"
5. エントリー ← entryFlag === "エントリー"
6. 求人紹介  ← entryFlag === "求人紹介" or 出力済BM
7. BM      ← BOOKMARKファイルが存在
8. 求人紹介前 ← 上記いずれにも該当しない
```

### supportSubStatus 全値一覧

ファイル: `src/lib/support-status-constants.ts`

| supportStatus | 取りうる supportSubStatus |
|--|--|
| BEFORE | 面談前 |
| ACTIVE | 求人紹介前, BM, 求人紹介, エントリー, 書類選考, 面接, 内定, 入社済 |
| WAITING | 待機 |
| ENDED | 当社判断, 本人希望 |
| ARCHIVED | (空文字) |

### スカウト関連サブステータスの有無

**存在しない。** "スカウト応募中"、"初回返信済"、"面談設定済" 等のスカウト固有ステータスは一切定義されていない。現行の supportSubStatus は **求人紹介プロセスの進捗** を表すもので、スカウト応募者の対応状況（返信した / 面談入れた）を表す設計ではない。

---

## 3. 既存「設定履歴」機能

### grep 結果

| ファイル | 内容 |
|--|--|
| `prisma/schema.prisma` L1090-1104 | `CandidateSettingsHistory` モデル定義 |
| `src/components/candidates/SettingsHistoryTab.tsx` | 設定履歴タブ UI コンポーネント |
| `src/app/api/candidates/[candidateId]/settings-history/route.ts` | GET API（候補者別履歴取得） |
| `src/app/api/rpa/mynavi/reply-sent/route.ts` | POST API（RPA一次返信完了通知→履歴書き込み） |
| `src/components/candidates/CandidateDetailPage.tsx` L109 | タブ定義で "設定履歴" を表示 |

### テーブル定義

```prisma
model CandidateSettingsHistory {
  id           String    @id @default(cuid())
  candidateId  String    @map("candidate_id")
  candidate    Candidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  sentAt       DateTime  @map("sent_at")
  sendType     String    @map("send_type")     // "MYNAVI_FIRST_REPLY"
  sendResult   String    @map("send_result")    // "SUCCESS" | "FAILURE"
  templateName String    @map("template_name")
  senderName   String    @map("sender_name")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([candidateId, sentAt])
  @@map("candidate_settings_histories")
}
```

### 機能概要

- **目的**: マイナビRPA が一次返信を送信した記録を保存・表示
- **データフロー**: RPA → `POST /api/rpa/mynavi/reply-sent` → `MynaviRpaProcessingLog.replySentAt` 更新 + `CandidateSettingsHistory` 新規作成
- **表示**: 求職者詳細画面の「設定履歴」タブでテーブル表示（送信日時 / 送信種別 / 結果 / 文章名 / 担当者）
- **sendType の種類**: 現在 `MYNAVI_FIRST_REPLY` と `MYNAVI_RESEND` の2種のみ（UIラベル定義）
- **固定値**: `templateName = "【日程調整】初回メッセージ"`, `senderName = "藤本 夏海"` がハードコード

### 制約

- 「初回返信した」ことの記録は **部分的にできている**（CandidateSettingsHistory に記録あり）
- ただし「面談設定した」「面談実施した」「キャンセル」「バックレ」の記録機能はこのテーブルにはない
- sendType を拡張すれば他イベントも記録可能な構造だが、現時点では一次返信のみ

---

## 4. 応募者一覧フィルター機能

### フィルター UI

ファイル: `src/app/(app)/admin/master/CandidateListClient.tsx`

| フィルター | 実装 | 備考 |
|--|--|--|
| テキスト検索（ID/氏名/カナ/CA名） | あり | |
| supportStatus タブ切替 | あり | ACTIVE / BEFORE / WAITING / ENDED / ALL / ARCHIVED |
| 担当CA | あり | ドロップダウン |
| 登録日範囲（from/to） | あり | |
| 性別 | あり | |
| 支援終了理由 | あり | ENDED タブのみ表示 |
| **applicationRoute（経路）** | **なし** | DB にカラムはあるがフィルター UI なし |
| **mediaSource（媒体）** | **なし** | 同上 |
| **supportSubStatus** | **なし** | 一覧表示はあるがフィルタリング不可 |

### フィルター適用ロジック（転記）

```typescript
const filtered = useMemo(() => {
  let result = candidates;
  if (supportTab === "ALL") {
    result = result.filter((c) => c.supportStatus !== "ARCHIVED");
  } else {
    result = result.filter((c) => c.supportStatus === supportTab);
  }
  if (debouncedSearch.trim()) {
    const q = debouncedSearch.trim().toLowerCase();
    result = result.filter(
      (c) =>
        c.candidateNumber.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.nameKana && c.nameKana.toLowerCase().includes(q)) ||
        (c.employee?.name && c.employee.name.toLowerCase().includes(q))
    );
  }
  if (caFilter !== "ALL") {
    result = result.filter((c) => c.employee?.id === caFilter);
  }
  if (dateFrom) {
    const from = new Date(dateFrom);
    result = result.filter((c) => new Date(c.createdAt) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo + "T23:59:59");
    result = result.filter((c) => new Date(c.createdAt) <= to);
  }
  if (genderFilter !== "ALL") {
    result = result.filter((c) => c.gender === genderFilter);
  }
  if (endReasonFilter !== "ALL") {
    result = result.filter((c) => c.supportEndReason === endReasonFilter);
  }
  return result;
}, [candidates, debouncedSearch, supportTab, caFilter, dateFrom, dateTo, genderFilter, endReasonFilter]);
```

### スカウト経由と他経路の区別

**UI上で不可。** `applicationRoute = "スカウト"` のデータは DB に格納されるが、一覧画面にはこの列の表示もフィルターもない。

---

## 5. スカウト応募流入経路

### 外部 API エンドポイント一覧

`src/app/api/external/` 配下:

| エンドポイント | メソッド | 用途 |
|--|--|--|
| `/api/external/candidate-birthday/[candidateNo]` | GET | 生年月日・メール取得（PAD用） |
| `/api/external/candidate-response` | POST | 求人への興味回答（WANT_TO_APPLY / INTERESTED） |
| `/api/external/candidate-summary/[jobSeekerId]` | GET | 候補者サマリー取得 |
| `/api/external/create-schedule-task` | POST | 日程調整タスク作成 |

### スカウト専用 API

**存在しない。** `src/app/api/external/scout*` のようなスカウト専用エンドポイントはない。

### RPA 関連 API（マイナビスカウトフロー）

| エンドポイント | メソッド | 書き込み先 | 概要 |
|--|--|--|--|
| `/api/rpa/mynavi/pdf-upload` | POST | `Candidate` + `CandidateFile` + `MynaviRpaProcessingLog` | PDF取込→AI解析→候補者登録 |
| `/api/rpa/mynavi/reply-sent` | POST | `MynaviRpaProcessingLog` + `CandidateSettingsHistory` | 一次返信完了通知 |

### pdf-upload が Candidate に書き込むフィールド

```typescript
{
  candidateNumber,
  name, nameKana, gender, email, phone, address,
  birthday,
  applicationRoute: "スカウト",     // ← 固定値
  mediaSource: "マイナビ転職",      // ← 固定値
  recruiterName,                   // ← リクエストパラメータ or AI抽出
  desiredJobType1, desiredJobType2, desiredIndustry1,
  desiredPrefecture, desiredEmploymentType, desiredSalaryMin,
}
```

### mediaSource の取りうる値

UI 定義（MEDIA_OPTIONS）:
- マイナビ転職
- indeed
- 日経HR
- 自社HP
- dodaMaps
- マイナビエージェント

RPA: `"マイナビ転職"` 固定

### applicationRoute の取りうる値

UI 定義（ROUTE_OPTIONS）:
- スカウト
- 応募

RPA: `"スカウト"` 固定

---

## 6. 結論（最重要）

### 結論1: 応募者一人ひとりに「初回返信した / 面談を入れた / 面談を実施した」が既に記録できる状態か

**部分実装**

| イベント | 記録可否 | 実装状態 | 備考 |
|--|--|--|--|
| 初回返信した | 部分的に可 | `CandidateSettingsHistory` (sendType=MYNAVI_FIRST_REPLY) + `MynaviRpaProcessingLog.replySentAt` | RPA 経由のみ記録可。手動返信は未対応 |
| 面談を入れた（面談設定済） | 不可 | **未実装** | InterviewRecord に interviewDate はあるが、「設定した」イベント自体の記録なし |
| 面談を実施した | 間接的に可 | `InterviewRecord.status` / `resultFlag` | 面談記録作成 = 実施とみなせるが、スカウトとの紐付けなし |
| キャンセル | 不可 | **未実装** | キャンセルを表すカラム・ステータスが存在しない |
| バックレ（無断欠席） | 不可 | **未実装** | 同上 |
| 日程変更 | 不可 | **未実装** | 変更履歴を残す仕組みなし |

**新規追加が必要なもの:**
- スカウト応募〜面談完了までの進行ステージを一元管理するモデル（ScoutRecord 相当）
- 面談設定・キャンセル・バックレ・日程変更のイベント記録
- 手動返信の記録手段

### 結論2: 応募者一覧で「未対応の人だけ表示」のような絞り込みが可能か

**不可**

- `applicationRoute` のフィルターが UI にないため、スカウト応募者だけを一覧表示できない
- 「初回返信未送信」「面談未設定」のような対応状況でのフィルタリングは仕組み自体が存在しない
- supportSubStatus でのフィルタリングも未実装（表示はあるが絞り込めない）

**追加で必要な実装:**
1. 一覧画面に applicationRoute / mediaSource フィルター追加（既存カラム活用、UI のみ）
2. スカウト応募者専用の進行ステータスフィルター（ScoutRecord 新設後）
3. 「未対応」「要対応」等のクイックフィルター

---

## 7. 新規開発スコープ提案

### サイズ感: 中（2テーブル新設 + 既存1テーブル拡張 + 1-2画面改修）

| 項目 | 種別 | 内容 |
|--|--|--|
| ScoutRecord テーブル | **新規** | candidateId, stage (RECEIVED/REPLIED/INTERVIEW_SET/INTERVIEW_DONE/CANCELLED/NO_SHOW), repliedAt, interviewSetAt, interviewHeldAt, cancelledAt, noShowAt, 各種メモ |
| ScoutStageHistory テーブル | **新規** | scoutRecordId, fromStage, toStage, changedAt, changedByUserId, memo（ステージ変遷ログ） |
| CandidateSettingsHistory | **既存拡張** | sendType に "MANUAL_REPLY" 等を追加。手動返信の記録に対応 |
| 求職者一覧フィルター | **既存改修** | applicationRoute / mediaSource フィルター追加 + ScoutRecord.stage フィルター追加 |
| スカウト進行管理ダッシュボード | **新規画面（任意）** | 全スカウト応募者の進行状況を集計・一覧表示。ファネル可視化 |
| RPA 連携 API 拡張 | **既存改修** | pdf-upload 時に ScoutRecord 自動作成 (stage=RECEIVED)、reply-sent 時に stage=REPLIED 更新 |

### 既存活用可能なもの（新規不要）

| 項目 | 理由 |
|--|--|
| 面談記録 | InterviewRecord が既に存在。ScoutRecord と紐付けるだけで面談実施の追跡可能 |
| 求職者基本情報 | Candidate に applicationRoute / mediaSource / recruiterName 済み |
| 一次返信記録 | CandidateSettingsHistory + MynaviRpaProcessingLog で RPA 分は記録済み |
| 求職者一覧画面 | CandidateListClient.tsx の既存フィルター基盤にフィルター追加のみ |

---

## 8. ナレッジ追記提案

### 03-portal-spec.md 追記案

「求職者管理」セクション末尾に追加:

```markdown
### スカウト応募者の進行管理

#### 現状（2026-05 時点）
- ScoutRecord モデルは未実装。スカウト応募者の進行ステージ（受信→返信→面談設定→面談実施）を一元管理するテーブルは存在しない
- 初回返信の記録は CandidateSettingsHistory (sendType=MYNAVI_FIRST_REPLY) で RPA 経由分のみ対応
- 面談実施は InterviewRecord で記録可能だが、スカウトフロー固有の紐付けなし
- キャンセル・バックレ・日程変更の記録機能なし

#### 識別方法
- `Candidate.applicationRoute = "スカウト"` でスカウト経由を識別
- `Candidate.mediaSource = "マイナビ転職"` で媒体を識別
- `Candidate.recruiterName` にスカウト配信者名を保持

#### 関連テーブル
- `CandidateSettingsHistory`: 一次返信送信履歴（設定履歴タブで表示）
- `MynaviRpaProcessingLog`: RPA処理ログ（replySentAt / replyResult）
- `InterviewRecord`: 面談記録（汎用。スカウト固有ではない）
```

### 02-data-sources.md 追記案

「RPA関連」セクション末尾に追加:

```markdown
### スカウト応募者データ

| データ | Source of Truth | 備考 |
|--|--|--|
| スカウト応募者の基本情報 | portal (Candidate) | RPA pdf-upload で自動登録、applicationRoute="スカウト" |
| 初回返信送信記録 | portal (CandidateSettingsHistory) | RPA reply-sent で自動記録 |
| スカウト配信者名 | portal (Candidate.recruiterName) | RPA or 手動登録 |
| スカウト進行ステージ | **未実装** | ScoutRecord モデル新設が必要 |
| 面談設定・実施記録 | portal (InterviewRecord) | 汎用。スカウトとの紐付けは未実装 |
```
