# T-183 面談サポート セッション保存不具合 調査報告（2026-08-28）

調査のみ。コード変更・コミット・push は一切行っていない。

## 1. 結論

**保存は最初から一度も成功していない（データ消失ではない）。原因は事実として特定済み。**

保存 API `src/app/api/interview-support/[interviewId]/session/route.ts` が、セッションユーザーの
`user.id`（**User テーブルの id**）をそのまま `createdByUserId` に入れて upsert しているが、
スキーマ上 `InterviewSupportSession.createdBy` の外部キーは **employees(id) を参照**している。
portal では User と Employee は**別テーブル・別 ID 空間**（Employee.userId → User.id の関連で結ぶ）のため、
**全 upsert が外部キー違反で失敗**し、1件も INSERT されなかった。

- 事実: 本番DB `interview_support_sessions` は **0件**（テーブル・マイグレーションは適用済み）
- 事実: 昨日 8/27 09:16:24〜09:50:54 JST に
  `Foreign key constraint violated on the constraint: interview_support_sessions_created_by_user_id_fkey`
  が **37回** 記録されている（約35分のテスト中、1分ごとの定期保存＋解説完了時保存がすべて失敗）
- 事実: クライアントは保存失敗時に UI を止めず、**連続失敗の初回だけ** toast 警告を出す設計
  （`InterviewSupportScreen.tsx:122-128`）のため、テスト中は正常に見えた
- 事実: タブの「面談サポートの記録はありません」は GET が正常に 0 件を返した結果で、表示側の不具合ではない
- 推測: 文字起こしデータは DB に無いため復元不能。sessionStorage 退避
  （キー `interview-support-log:<interviewId>`）はタブを閉じた時点で消えるため、残っている可能性は低い

## 2. 調査1: 本番DBの実データ

接続: `railway ssh`（Project bizstudio-portal / env production / service bizstudio-portal）+
コンテナ上 Node + PrismaPg。`railway run` は不使用。

### スキーマ（prisma/schema.prisma:2261-2276）

```prisma
model InterviewSupportSession {
  id                String          @id @default(cuid())
  interviewRecordId String          @map("interview_record_id")
  interviewRecord   InterviewRecord @relation(fields: [interviewRecordId], references: [id], onDelete: Cascade)
  createdByUserId   String          @map("created_by_user_id")
  createdBy         Employee        @relation("interviewSupportCreatedBy", fields: [createdByUserId], references: [id])
  startedAt         DateTime        @map("started_at")
  endedAt           DateTime?       @map("ended_at")
  transcript        Json
  explanations      Json
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  @@index([interviewRecordId])
  @@map("interview_support_sessions")
}
```

→ `createdBy` は **Employee** 参照。migration.sql（prisma/migrations/20260827090000_t183_interview_support_session/migration.sql:26）でも
`FOREIGN KEY ("created_by_user_id") REFERENCES "employees"("id")`。

### クエリ結果（2026-08-28 実行・生データ）

```
===MIG=== [{"migration_name":"20260827090000_t183_interview_support_session","finished_at":"2026-08-26T15:23:18.175Z"}]
===TBL=== [{"t":"interview_support_sessions"}]
===CNT=== [{"n":0}]
===ROWS=== []
```

- マイグレーション適用: 2026-08-26 15:23:18 UTC = **8/27 00:23 JST**（Phase 2 デプロイの2分前。手順どおり）
- テーブル存在: あり
- **総件数: 0件** → 求職者 JOIN（調査1-4）は対象なし

## 3. 調査2: 保存経路の実コード

### クライアント（src/components/interview-support/InterviewSupportScreen.tsx）

- 定期保存タイマー（134-138行）: `listening` 中のみ `AUTOSAVE_INTERVAL_MS = 60_000`（28行）で `saveSession()`。停止でクリア
- 保存トリガは他に: 停止時（149-153行 `handleStop`）、解説カード完成時（413-417行）、自動検知反映時（386行）、beforeunload keepalive（204-214行）
- sessionId 生成（140-147行 `handleStart`）: 初回「開始」で `crypto.randomUUID()`。以後同一 ID へ upsert
- 保存関数（74-131行 `saveSession`）:
  - ガード: `dbSessionRef` 未設定（開始前）または `entries===0 && doneCards===0` なら送信しない（76-80行）
  - fetch 先: `POST /api/interview-support/${interviewId}/session`、`Content-Type: application/json`（112-117行）
  - payload: `{ sessionId, startedAt: ISO文字列, endedAt: ISO文字列|null, transcript: [{t,text}], explanations: [{t,mode,sourceText,resultText}] }`（105-111行）
  - エラー処理（118-128行）: `res.ok` でなければ throw → catch で**初回のみ** `toast.warning("記録の自動保存に失敗しました。次回の保存で再試行します")`。以降の失敗は無通知

### API（src/app/api/interview-support/[interviewId]/session/route.ts 全75行の要点）

- 認証（24-25行): `getSessionUser()` が null なら 403
- バリデーション（30-44行、zod 不使用の手書き）:
  - sessionId: 空でなければ**形式チェックなし**（UUID でも cuid でも通る。主キーは String なので矛盾なし）
  - startedAt/endedAt: `new Date(ISO文字列)` で NaN チェックのみ → クライアントの ISO 送信と整合
  - transcript/explanations: `Array.isArray` のみ。**mode の値（auto-term/auto-job/auto-reason 含む）は一切検証していない** → Phase 3 の mode が弾かれることはない
- 面談レコード存在チェック（46-50行）: 無ければ 404
- **upsert（55-71行）— 問題箇所**:

```ts
const session = await prisma.interviewSupportSession.upsert({
  where: { id: sessionId },
  create: {
    id: sessionId,
    interviewRecordId: interviewId,
    createdByUserId: user.id,   // ← User.id を Employee FK の列に入れている
    ...
```

`getSessionUser()`（src/lib/auth.ts:28-38）は `prisma.user.findUnique({ where: { id: userId } })` で
**User** を返す。一方 Employee は別モデル（schema.prisma:215-221、`userId String? @unique` で User に関連）。
既存の面談レコード作成 API は変換を行っている（src/app/api/interviews/route.ts:329-331）:

```ts
// Employee取得
const employee = await prisma.employee.findFirst({ where: { userId: user.id } });
if (!employee) return NextResponse.json({ error: "従業員情報が見つかりません" }, { status: 400 });
```

保存 API にはこの変換が**無い**。これが唯一かつ決定的な不整合。

### 不整合チェック結果（調査2-3）

| 項目 | 結果 |
|--|--|
| fetch URL とルートパス/パラメータ名 | 一致（`/api/interview-support/[interviewId]/session`・POST） |
| sessionId 形式（UUID） vs 検証/主キー型 | 問題なし（形式検証なし・String PK。cuid 検証は存在しない） |
| 日付 ISO 文字列 vs 期待 | 一致 |
| Phase 3 mode の保存バリデーション | 検証自体が無く弾かれない |
| 認証/credentials | 同一オリジン fetch で cookie は自動送信。403 は出ていない |
| **createdByUserId = User.id vs FK employees(id)** | **不一致 → 全保存が FK 違反（真因）** |

## 4. 調査3: 本番ログ

デプロイのタイムライン（`railway deployment list` + git log）:

| 時刻(JST) | コミット | デプロイ |
|--|--|--|
| 8/26 23:58 | 1675530 Phase 1 | 89a550d4 |
| 8/27 00:01 | 905b0c4 Toaster 修正 | 3860b93b |
| 8/27 00:23 | （migrate deploy 完了） | — |
| 8/27 00:25 | fd6cf08 Phase 2（保存コード） | 4ab11ff6 ← 昨日終日稼働 |
| 8/28 07:42 | 391a68f Phase 3 | 91cc2cf4 ← 現行（`RAILWAY_GIT_COMMIT_SHA=391a68fa…` をコンテナ env で確認） |

デプロイ 4ab11ff6 のログ（`railway logs -d 4ab11ff6… --filter …`、生データ抜粋）:

```
⨯ Error [PrismaClientKnownRequestError]:
Invalid `prisma.interviewSupportSession.upsert()` invocation:
Foreign key constraint violated on the constraint: `interview_support_sessions_created_by_user_id_fkey`
```

- 件数: **37件**
- 初回: 2026-08-27T00:16:24Z（= 09:16:24 JST）
- 最終: 2026-08-27T00:50:54Z（= 09:50:54 JST）
- → 昨日朝の約35分のテストセッション。1分間隔の定期保存＋随時保存がすべて失敗した回数と整合
- HTTP ステータス: route に try/catch が無いため Next.js が 500 を返却（クライアントは `save failed: 500` → toast 1回のみ）
- 現行デプロイ（Phase 3）のログには同エラー **0件**（本日はまだ保存試行なし）

## 5. 調査4: タブ表示経路

- GET 一覧（src/app/api/interview-support/sessions/route.ts:20-36）: `?candidateId=` を受け取り
  `where: { interviewRecord: { candidateId } }`。JOIN 条件は正しい
- タブ（src/components/interview-support/InterviewSupportLogTab.tsx:94-104）: props の `candidateId` を
  そのままクエリに付与。InterviewForm.tsx:1951 で `<InterviewSupportLogTab candidateId={candidateId} interviewId={interviewId} />`
- 「保存はあるのに一覧が空」になり得る条件: ①セッションが別求職者の面談レコードに紐づく
  ②GET 自体の失敗（この場合は「取得に失敗しました」表示になるため今回と別症状）
- → 今回は DB 0件なので表示経路は無関係。表示コードに不具合は見つからなかった

## 6. 修正方針の提案（実装は次プロンプトで）

1. **本命**: 保存 API に既存パターン（interviews/route.ts:330）どおりの Employee 解決を入れる
   - `const employee = await prisma.employee.findFirst({ where: { userId: user.id }, select: { id: true } });`
   - 無ければ 400（「従業員情報が見つかりません」）
   - `create.createdByUserId` に `employee.id` を渡す。update 側は createdBy を触らないので変更不要
   - スキーマ・マイグレーション変更は不要（GET 一覧の `createdBy.name` は Employee 参照のままで正しく動く）
2. **任意（再発時の可視性）**: 保存失敗 toast を「初回のみ」から失敗継続中は再通知 or 画面上部に常設バナーへ。
   500 の本文にエラー種別を入れると切り分けが速くなる
3. **データ復旧**: DB に 0件のため昨日の文字起こしは復元不能。sessionStorage はタブクローズで消える設計
4. 修正は既存ロジック変更（保存 API の挙動変更）だが実質バグ修正の1行追加系。デプロイ判断はルール上
   staging 経由が無難（判断は任せる）
