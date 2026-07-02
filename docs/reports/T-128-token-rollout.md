# T-128 公開準備② 求人サイトURL発行ボタン＋一括発行 — 完了報告

実施日: 2026-07-03 ／ 対象: bizstudio-portal（本番=master）
前提①: kyuujinPDF `POST /api/external/tokens/issue`（冪等・commit daae6e1/7a82b29）デプロイ済みを OpenAPI と認証境界401で実確認のうえ着手。

---

## 0. 前提①の契約（実確認済み）
`POST https://web-production-95808.up.railway.app/api/external/tokens/issue`（`x-api-secret`）
- req: `candidateNumber`(必須) / `birthDate`(任意 YYYY-MM-DD) / `expiryDays`(既定180) / `createdBy`
- res: `token` / `siteUrl` / `issued`(true=新規/false=既存＝冪等) / `warning`(誕生日不一致・期限切れ等)
- 認証境界: no-secret / wrong-secret とも **401** を実確認。

---

## 1. CA画面「求人サイトURLを発行」ボタン

### 設置場所
候補者詳細ヘッダ（`CandidateHeader.tsx`）の「URL・資料:」ボタン行（Row 3）の先頭。求人マイページ/ガイドURL等と並ぶ、面談後に自然に押せる位置。支援ステータスに関わらず常時表示。

### 挙動（`IssueSiteTokenButton.tsx` + portal API）
- 押下 → portal 内部API `POST /api/candidates/[candidateId]/issue-site-token`（セッション認証）→ kyuujinPDF issue を代理呼び出し（**secret はサーバー側に隠蔽**）。
- 成功時: **siteUrl をモーダル表示＋ワンクリックコピー**。冪等なので2回目以降も同一URL（`issued:false` は「発行済み」と表示）。
- `warning` があれば黄色帯で明示（誕生日不一致・期限切れ等）。
- **誕生日未登録**: `{ ok:false, reason:"no-birthday" }` を返し、モーダルに「生年月日が未登録のため発行できません（候補者情報に登録してください）」を表示・発行しない（**誕生日の推測補完なし**）。

### 案内文テンプレ（後から調整できる定数）
`IssueSiteTokenButton.tsx` の `ANNOUNCEMENT_TEMPLATE`:
```
非公開求人サイトのご案内です。
こちらのURLから、生年月日（8桁）でログインしてご覧いただけます。
{URL}
```
`{URL}` を発行URLに置換してモーダルに表示＋「案内文をコピー」ボタン。

---

## 2. 一括発行スクリプト `scripts/issue-site-tokens-bulk.ts`

### 対象条件
- 既定: **Interview 1件以上 AND supportStatus=ACTIVE(支援中) AND birthday 登録済み**。
- `--include-inactive`: 全ステータス（面談＋誕生日あり）へ拡大（将来の掘り起こし用・今回未使用）。
- `--dry-run`: 集計のみで本実行しない。
- 動作: dry-run 集計をログ出力 → 続けて本実行（issue API を **5並列**）。**安全ガード**: 対象0人 or 対象>全候補者数 で本実行中止。失敗はスキップ記録（全体を止めない）。

### ⚠️ JSTタイムゾーン対応（重要）
`birthday`(@db.Date) を JS Date 経由で `toISOString()` すると **JSTで1日ズレる**（例: 5999999 は DB上 1983-05-05 だが UTC変換で 1983-05-04 になり誕生日不一致 warning が出る）。
→ portal API・一括スクリプトとも **Postgres `TO_CHAR(birthday,'YYYY-MM-DD')`** で純粋な日付文字列を取得し送信（TZ変換を完全回避）。実測で「1983-05-05→warning無し／1983-05-04→不一致warning」を確認し正しさを実証。

---

## 3. 一括発行 結果集計（本実行）

| 区分 | 件数 |
|---|---|
| 全候補者 | 4,069 |
| 面談登録済み | 2,913 |
| **対象（ACTIVE×面談×誕生日）** | **84** |
| ├ 新規発行 | **7** |
| ├ 既存（冪等・再利用） | 77 |
| ├ warning付き | 5（内訳下記） |
| └ 失敗(failed) | 0 |
| skip 合計 | 2,829 |
| ├ 誕生日未登録 | 1 |
| └ 支援対象外(非ACTIVE) | 2,828（BEFORE 2,644 / ENDED 170 / WAITING 14） |

- **支援終了(ENDED)への発行=0 を CSV で確認**（spec遵守。ENDED 170 は全て skip）。
- ACTIVE 総数 87 → 誕生日あり 86 → 面談あり 84 と一致（対象数の妥当性を独立クエリで確認）。
- **warning 5件は全て「既存トークンは有効期限切れです」**（candidateNumber: 5004062 / 5004405 / 5004411 / 5004447 / 5004595）。issue は冪等のため期限切れトークンを上書き更新せず既存を返す設計。**この5名は既存トークンが期限切れのままのため、別途更新運用が要検討**（本タスクのスコープ外・下記フォロー参照）。
- CSV: `verify/site-token-rollout-20260703.csv`（2,913行＝面談済み全件。列: candidateNumber, result[新規/既存/failed/skip], warning, skipReason）。既存 verify/ CSV と同様、PII配慮でリポジトリには**コミットせずローカル保持**。

---

## 4. 検証結果

| # | 検証項目 | 結果 |
|---|---|---|
| 1 | issue API 認証境界 | no-secret/wrong-secret → **401** ✓ |
| 2 | ボタン portal API E2E（5999999・セッション付き） | `ok:true` / siteUrl返却 / **issued:false（新規発行されない）** / warning:null ✓ |
| 3 | 誕生日未登録ガード | `{ok:false, reason:"no-birthday"}` ✓ |
| 4 | 認証（cookieなし） | **403** ✓ |
| 5 | JST誕生日の正しさ | 1983-05-05→warning無し／1983-05-04→不一致warning（TO_CHAR方式で正）✓ |
| 6 | 一括 dry-run と本実行の整合 | 対象84・除外内訳が一致 ✓ |
| 7 | **新規発行1名の /site ログイン実確認**（5008110・番号マスク） | 誕生日8桁 `20030801` で verify **success**（auth_key発行）／誤誕生日は「生年月日が正しくありません」✓ |
| 8 | 支援終了者の非発行 | ENDEDで発行された行 **0** ✓ |
| 9 | 本番ビルド | 成功・ルート `/api/candidates/[candidateId]/issue-site-token` 登録 ✓ |

---

## 5. コミット・push・デプロイ
- コミット: `feat(candidate-site): issue-URL button and bulk token rollout for active interviewed candidates`
- add 対象（パス明示・`git add -A` 不使用）:
  - `src/app/api/candidates/[candidateId]/issue-site-token/route.ts`（新規）
  - `src/components/candidates/IssueSiteTokenButton.tsx`（新規）
  - `src/components/candidates/CandidateHeader.tsx`（ボタン組込み）
  - `scripts/issue-site-tokens-bulk.ts`（新規）
  - `docs/reports/T-128-token-rollout.md`（本報告）
- **コミットID: `4c1a4ba`**（`4cd4581..4c1a4ba master -> master`）
- **push: 成功**（origin master）
- **Railwayデプロイ: SUCCESS**（BUILDING→DEPLOYING→SUCCESS、約224s）
- 本番到達性確認: `POST .../issue-site-token`（cookieなし）→ **403**（404ではない＝ルートがデプロイ済み・セッション認証が有効）。

---

## 6. フォロー提案（スコープ外・将幸さん判断）
- **期限切れトークン5名（warning）**: issue が期限切れを上書きしないため、対象5名のトークンは失効したまま。①側で「期限切れは再発行」する挙動にするか、対象を deactivate→再issue する運用が要検討。
- 掘り起こし一括（支援終了・休眠含む）は配信手段が整った段階で `--include-inactive` で実行可能（作り込み済み）。
