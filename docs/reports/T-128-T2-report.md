# T-128 T2 完了報告：求職者サイト向け portal API（お気に入り一覧・本人追加・応募受付＋CA通知）

実施日: 2026-07-02 ／ 対象: bizstudio-portal（本番=master）
コミット: **75a206a** ／ 本番デプロイ: SUCCESS 確認済み

---

## 1. マイグレーション（既存不変・安全弁付き）

`prisma/migrations/20260702110000_t128_candidate_site/migration.sql`

| 変更 | 内容 |
|---|---|
| `candidate_files.origin` 列追加 | TEXT nullable。**null/'ca'=CA追加（既存行はNULLのまま=CA扱い）／'candidate'=本人追加**。既存行の書き換えなし |
| `candidate_job_applications` 新テーブル | id / candidate_id(FK→candidates, Cascade) / external_job_ref / applied_at / notified_at / created_at / updated_at。`@@unique([candidateId, externalJobRef])` で重複応募防止 |
| 安全弁 | **`SET lock_timeout='5s'`** を先頭に付与（ロック待ちで全体を詰まらせない・冪等なので失敗時は再実行可） |

**適用前後の本番応答実測（悪化なし）**:
- 適用直前: 候補者詳細 0.19〜0.33s（合格基準1秒未満クリア）
- 適用直後: 0.18〜0.28s（悪化なし）
- デプロイ直後: 初回2.2s（コールドスタート）→ 0.79〜0.80s で安定

既存行不変の確認: ALTER は nullable 列追加のみ（PG11+はメタデータ変更・データ書換なし）。既存28件のブックマークは origin=NULL のまま「ca」として一覧に返ることを実測確認。

## 2. エンドポイント仕様（T3 mypage BFF 向け接続情報）

ベースURL: `https://bizstudio-portal-production.up.railway.app`

### 認可（3エンドポイント共通）
- ヘッダ: **`X-Auth-Key: <キー値>`**
- 環境変数: **`CANDIDATE_SITE_API_KEY`**（portal 本番 Railway に設定済み・64桁hex。値は Railway ダッシュボードで確認し mypage BFF 側に設定する。キー値は本報告に記載しない）
- 未設定・欠落・不一致はすべて **401**（fail-closed）。比較は timingSafeEqual。
- 候補者指定: クエリ/body の `candidateNumber`（例 "5999999"）または `candidateId`（cuid）。**mypage BFF が ShareToken＋誕生日で本人確認済みの識別子を渡す前提**（portal は誕生日を扱わない）。portal は該当候補者の存在確認後、全データアクセスをその候補者に厳密スコープ。

### ① お気に入り一覧
```
GET /api/external/candidate-site/favorites?candidateNumber=5999999
```
レスポンス:
```json
{
  "ok": true,
  "candidateNumber": "5999999",
  "favorites": [{
    "id": "...", "externalJobRef": "hl-ap-164691",   // 旧PDF行は null
    "sourceType": "job-platform",                      // 旧PDF行は null
    "origin": "ca",                                    // "ca" | "candidate"
    "fileName": "求人票_〇〇株式会社_1234567890.pdf",
    "companyName": "〇〇株式会社",                      // fileNameから抽出（旧PDFはnullあり）
    "jobUrl": "https://...",                           // memo由来・なければnull
    "aiMatchRating": "A",                              // AI評価済みなら
    "createdAt": "2026-07-02T...", "applied": false
  }],
  "appliedExternalJobRefs": ["hl-..."]                 // 応募済み一覧（「応募済み」表示用）
}
```
- **旧PDF経路（sourceType=null）の行も返す**（identifier・メタは落とさない。T3が kyuujinPDF 既存経路で肉付け）。

### ② 本人お気に入り追加・解除
```
POST /api/external/candidate-site/favorites
body: { candidateNumber, externalJobRef, companyName?, jobTitle?, jobUrl?, extractedText? }
→ { ok, created, alreadyExists?, favorite }
```
- origin='candidate' で CandidateFile に追記。**記録のみ**（PDF生成・Drive保管・会社説明生成・AI分析は一切起動しない）。
- 重複ガード: 同一候補者×同一 externalJobRef の既存行（CA追加含む）があれば新規作成せず既存を返す。
```
DELETE /api/external/candidate-site/favorites
body: { candidateNumber, externalJobRef }
→ { ok, removed }  ／ CA追加行は 403 {"reason":"ca-added-not-removable"}
```
- 解除は origin='candidate' 行のみ（アーカイブ方式・物理削除しない）。

### ③ 応募受付＋担当CA通知
```
POST /api/external/candidate-site/apply
body: { candidateNumber, externalJobRef, companyName?, jobTitle? }
→ { ok, created, alreadyApplied?, applicationId, appliedAt, notified }
```
- CandidateJobApplication に記録 → 担当CA（Candidate.employee）へ **LINE WORKS 通知**（既存タスク通知と同一Bot/トークルーム・lineUserId があればメンション、無ければ「◯◯さん」名前プレフィックス）。
- 重複応募は同一行を返し**二重通知しない**。通知失敗でも**応募記録は残る**（notifiedAt=null・ログに残す・再送可能）。

## 3. 検証結果（本番実測）

| # | 検証項目 | 結果 |
|---|---|---|
| 1 | 認可: no-key / wrong-key | **401 / 401** ✓ |
| 1 | 認可: 正キー | **200** ✓ |
| 1 | **IDすり替え**: 存在しない候補者 | 404 Candidate not found ✓ |
| 1 | **スコープ**: 別候補者(5008137)指定 | その候補者の18件のみ・テストデータ混入なし ✓ |
| 2 | 一覧（大野テスト 5999999） | 28件（job-platform 9・旧PDF 19）・origin区分・appliedRefs 返却 ✓ |
| 3 | 本人追加 | created=true・**origin='candidate'** ✓ |
| 3 | **後続処理が走らない** | 追加後の本番ログに pdf-service/Drive/ExtractText/analyze 等 **一切なし** ✓ |
| 3 | 重複ガード（本人再追加／CA追加済みを本人追加） | 両方 alreadyExists=true・新規行なし ✓ |
| 3 | 解除: CA行 | **403** ca-added-not-removable ✓ |
| 3 | 解除: 本人行 | removed=true・一覧から消える ✓ |
| 4 | 応募記録＋**LINE WORKS実送**（担当CA=大野将幸さん宛） | **notified=true**（本番トークルームに実送達）・notifiedAt記録 ✓ |
| 4 | 重複応募 | 同一applicationId返却・**二重通知なし** ✓ |
| 5 | 既存CA追加経路の不変 | `from-job-platform`/`saved-jobs` ルートは無変更（git diffゼロ）。既存28行のブックマークは origin=NULL のまま ✓ |
| 6 | ビルド | tsc/eslint クリーン・Railway ビルド成功 ✓ |

検証に使ったテストデータ（hl-t128-*）は全て削除済み（応募2行・favorite 2行）。本番候補者データは読み取りのみ。

## 4. 制約・注意（T3実装者向け）
- `jobTitle` は現状 CandidateFile に専用列が無いため保存しない（会社名は fileName に反映）。カード表示のタイトルは job-platform 側 API から取得する想定。
- 本人追加時に `extractedText`（求人本文）を渡せば保存され、後日CAがAI分析を実行する際の材料になる（**渡しても分析は自動起動しない**）。
- staging サービスには CANDIDATE_SITE_API_KEY 未設定＝fail-closed で全401（意図どおり）。

## 5. 経緯メモ
- 実装途中に Railway インフラ障害（本番コンテナ→DBプロキシ網の egress 断）で中断。復旧・真因は `docs/reports/T-128-T2-incident.md` 参照。
- 再開時にマイグレーションへ lock_timeout='5s' を追加し、適用前後の応答実測（上記）で悪化なしを確認して反映した。
