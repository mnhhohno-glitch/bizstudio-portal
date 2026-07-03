# T-131 Phase1-②: 手動アップPDFのフルデータ化 — portal側接続点調査

調査日: 2026-07-04 ／ 対象: bizstudio-portal（master）

---

## 1. 現行アップロード経路の全体像

### 1-1. CA手動アップロード（PDF由来・sourceType=NULL）

```
[CA] 候補者詳細 → 紹介履歴タブ → 📁ブックマーク
  → ＋アップロードボタン or ドラッグ＆ドロップ
  ↓
[フロント] HistoryTab.tsx:BookmarkSection.uploadFiles() (line 823)
  → POST /api/candidates/{candidateId}/files/upload
    formData: file=PDF, category="BOOKMARK"
  ↓
[API] src/app/api/candidates/[candidateId]/files/upload/route.ts
  1. バリデーション（20MB上限・MIME/拡張子チェック）
  2. Google Drive → getOrCreateFolder → uploadFileToDrive
  3. prisma.candidateFile.create({
       category: "BOOKMARK",
       fileName: 元ファイル名（例: 求人票_会社名_20260413194430596.pdf）,
       driveFileId, driveViewUrl, driveFolderId,
       mimeType: "application/pdf",
       sourceType: NULL,  // ← PDF由来の印（NULL = 手動PDF）
       externalJobRef: NULL,
       uploadedByUserId: ログインユーザー
     })
  4. recalculateSubStatusIfAuto(candidateId)
  ↓
[フロント] triggerExtraction(uploadedFileIds, ":upload") (line 852)
  → POST /api/candidates/{candidateId}/bookmarks/extract-text
  ↓
[API] src/app/api/candidates/[candidateId]/bookmarks/extract-text/route.ts
  1. Google Drive から PDF バイナリ取得
  2. pdf-parse（テキストPDF）→ 50文字未満なら外部OCR（PDF_EXTRACTOR_URL）
  3. prisma.candidateFile.update({ extractedText, extractedAt })
  ↓ ← ここまでがアップ直後。以降はCAの任意操作 ↓
[CA] 「AI評価実行」ボタン → POST /api/candidates/{candidateId}/bookmarks/analyze-batch
  → Claude API（3軸評価＋コメント生成）→ aiMatchRating/aiAnalysisComment 更新
  ↓
[CA] 「求人出力へ送信」ボタン → POST /api/candidates/{candidateId}/bookmarks/send-to-job-tool
  → kyuujinPDF API 7ステップ（§1-3参照）
  → lastExportedAt / lastExportedTo 更新
```

### 1-2. 入口の全列挙

| # | 入口 | 場所 | category | sourceType |
|---|------|------|----------|------------|
| A | **ブックマーク＋アップロード** | HistoryTab.tsx BookmarkSection | BOOKMARK | NULL |
| B | **ブックマーク ドラッグ&ドロップ** | 同上 onDrop | BOOKMARK | NULL |
| C | **書類タブ FileUploadModal** | DocumentsTab.tsx → FileUploadModal.tsx | 手動選択（BOOKMARK可） | NULL |
| D | **job-platform 外部API** | `/api/external/bookmarks/from-job-platform` | BOOKMARK | "job-platform" |
| E | **求職者サイト お気に入り追加** | `/api/external/candidate-site/favorites` POST | BOOKMARK | "job-platform" |

**T-131 の対象は A/B/C（PDF由来・sourceType=NULL のCA手動アップ）のみ**。
D/E は既に job-platform 由来で externalJobRef を持ち、PDF抽出パイプラインは不要。

### 1-3. 「求人出力」（send-to-job-tool）の kyuujinPDF 呼出一覧

`src/app/api/candidates/[candidateId]/bookmarks/send-to-job-tool/route.ts`

| Step | kyuujinPDF API | 用途 |
|------|---------------|------|
| 1 | `GET /api/projects/by-job-seeker-id/{num}/jobs` | 既存プロジェクト確認 |
| 1 | `POST /api/projects` or `PATCH /api/projects/{id}` | プロジェクト作成/db_type更新 |
| 1 | `POST /api/projects/{id}/processing-units` | 処理単位(バッチ)作成 |
| 3a | `POST /api/upload/projects/{id}/files/batch` | PDF一括アップ（Circus） |
| 3b | `POST /api/drive/upload/auto-process/batch` | PDF一括アップ（HITO-Link/マイナビ） |
| 4 | `POST /api/projects/{id}/memos/import` | メモ帳インポート |
| 5 | `POST /api/projects/{id}/complete-files` | ファイル受領マーク |
| 5.5 | `PUT /api/external/mypage/jobs/ca-comment` | CAコメント送信 |
| 6 | `POST /api/extraction/projects/{id}/extract` | 求人抽出実行 |

---

## 2. 新フローの挿入点

### 2-1. 設計案: 非同期パイプライン（推奨）

```
[CA] PDF アップ（従来どおり）
  ↓  ★変更なし：files/upload → Drive保管 → CandidateFile作成
  ↓  ★変更なし：extract-text → PDF→テキスト抽出
  ↓
[追加] job-platform 投入キュー（非同期）
  → POST /api/candidates/{candidateId}/bookmarks/submit-to-platform (新設)
    payload: { fileId, extractedText, fileName }
  → job-platform 側抽出パイプライン（数十秒〜数分）
  → 完了 webhook: POST /api/external/bookmarks/platform-result (新設)
    payload: { fileId, sourceJobId, extractedData }
  → prisma.candidateFile.update({
       externalJobRef: sourceJobId,      // 既存フィールド流用
       sourceType: "job-platform-enriched"  // PDF由来だがフルデータ化済み
     })
```

**挿入点**: `files/upload/route.ts` の **line 174-180 付近**（`record.category === "BOOKMARK"` ブロック直後）。
extract-text の完了を待ってから投入するため、実際のトリガーは **extract-text/route.ts の line 124-130 直後**（extractedText 保存後）が適切。

```typescript
// extract-text/route.ts の extractedText 保存後に追加:
if (text && file.sourceType === null) {
  // 非同期投入（fire-and-forget・失敗しても既存フローを壊さない）
  submitToJobPlatform(file.id, text, file.fileName).catch(e => {
    console.error("[ExtractText] job-platform submit failed (non-blocking):", e);
  });
}
```

### 2-2. 同期 vs 非同期の判断

| 方式 | 利点 | 欠点 |
|------|------|------|
| **同期**（アップ時にjob-platform投入→完了待ち） | sourceJobId が即確定 | 抽出に数十秒〜数分 → CAのアップUX劣化（現行は1-2秒で完了） |
| **非同期**（推奨） | CAの操作は1つも増えない | sourceJobId 確定まで数分のラグ → 表示は段階的反映 |

**非同期が適切**。理由:
- 抽出パイプラインは数十秒かかる前提 → 同期だとアップ体感が10x以上悪化
- 「CAの操作は1つも増やさない前提」を満たすのは非同期のみ
- 既存の extract-text も fire-and-forget で動いており、同パターンを踏襲

### 2-3. 失敗時フォールバック

**原則: job-platform 投入は既存フローの「追加層」であり、失敗しても現行動作を一切壊さない。**

```
失敗パターン                          フォールバック
───────────────────────────────────────────────────────────
job-platform API不達/タイムアウト   → ログ出力のみ。CandidateFile は sourceType=NULL のまま残る。
                                     → 後続の AI評価・求人出力は従来どおり動作（extractedText依存）。
抽出パイプラインが不正結果返却      → sourceJobId を設定しない。status列で検知可。
webhook が portal に届かない        → sourceJobId 未設定のまま。定期リコンサイルで拾う。
```

**リトライ/検知案**:
- `CandidateFile` に `platformSubmittedAt` (DateTime?) 列を追加。
  投入時に立て、webhook で sourceJobId 確定時にクリア。
  5分以上経過 & sourceJobId=NULL & platformSubmittedAt!=NULL → stale → 再投入。
- または cron バッチで `sourceType IS NULL AND extractedText IS NOT NULL AND platformSubmittedAt IS NULL` を日次掃引。

### 2-4. スキーマ変更（最小限）

```prisma
model CandidateFile {
  // 既存フィールド流用（追加不要）:
  //   externalJobRef   → job-platform の sourceJobId を格納
  //   sourceType       → "job-platform-enriched" で区別
  
  // 追加候補:
  platformSubmittedAt  DateTime?  @map("platform_submitted_at")  // 投入済みフラグ
}
```

`externalJobRef` は既に nullable String で存在し、job-platform 由来行で使用中。
PDF由来行にも同フィールドを使えばスキーマ変更は `platformSubmittedAt` の1列のみ。

---

## 3. kyuujinPDF登録の今後

### 3-1. kyuujinPDF に依存する機能の実コード確認

| 機能 | kyuujinPDF依存 | 根拠（portalコード） |
|------|---------------|---------------------|
| **紹介リスト表示（紹介履歴タブ 求人一覧）** | ✅ 毎回GET | `jobs/route.ts` → `GET /api/projects/by-job-seeker-id/{num}/jobs` |
| **求人出力（HITO-Link/Circus/マイナビ送信）** | ✅ 7ステップ | `send-to-job-tool/route.ts` 全体 |
| **マイページ（/v/）の求人表示** | ✅ kyuujinPDF Job が source of truth | CLAUDE.md「求人マスター → kyuujinPDF が source of truth」 |
| **マイページ 気になる/応募したい** | ✅ kyuujinPDF JobFeedback | `candidate-response/route.ts` で portal ミラー |
| **対象外（EXCLUDED）管理** | ✅ kyuujinPDF feedback_status | `job-introductions/route.ts` DELETE |
| **復帰（un-exclude）** | ✅ kyuujinPDF restore | `restore-jobs/route.ts` |
| **ダッシュボード（閲覧回数・最終ログイン）** | ✅ kyuujinPDF から取得 | `dashboard/route.ts` |
| **CAコメント同期** | ✅ kyuujinPDF ca-comment | `sync-ca-comments/route.ts` |
| **マイページURL発行** | ✅ kyuujinPDF token | `issue-site-token/route.ts` |
| **AI求人評価（analyze-batch）** | ❌ 不要 | `analyze-batch/route.ts` は extractedText のみ使用 |
| **テキスト抽出（extract-text）** | ❌ 不要 | `extract-text/route.ts` は Drive PDF のみ |
| **ブックマーク一覧表示** | ❌ 不要 | CandidateFile ローカルDB |

### 3-2. 「二重登録」の妥当性判定

**結論: 当面は二重登録（kyuujinPDF＋job-platform）が妥当。kyuujinPDFを外すのは段階的移行完了後。**

理由:
1. **マイページ（/v/）は kyuujinPDF Job が source of truth**。job-platform に移行するには bizstudio-mypage の表示・求職者サイトのお気に入り表示の両方を書き替える必要がある（本タスクのスコープ外）。
2. **求人出力（send-to-job-tool）は kyuujinPDF のプロジェクト→メモ→抽出の7ステップに依存**。これを job-platform に置き替えるのは別プロジェクト。
3. **紹介リスト表示は kyuujinPDF の `/api/projects/by-job-seeker-id/{num}/jobs` を毎回GETしている**。ローカル化するには JobEntry/JobIntroduction テーブルの新設＋データ同期が必要。
4. **EXCLUDED/復帰・気になる/応募したい は kyuujinPDF 側の feedback_status に書き込む**。

→ **フルデータ化（job-platform 投入）は「求職者サイトでの詳細表示」のための追加層であり、kyuujinPDF への求人出力は別経路として残す**。CAの「求人出力へ送信」→ kyuujinPDF 7ステップは不変。

---

## 4. 遡及の見積もり（実カウント・2026-07-04）

### 4-1. 全体件数

| 区分 | 全件 | アクティブ | アーカイブ | 候補者数 |
|------|------|-----------|-----------|---------|
| **BOOKMARK 全体** | 5,326 | 4,318 | 1,008 | 212 |
| **PDF由来**（sourceType=NULL） | 5,185 | **4,204** | 981 | 210 |
| **job-platform由来** | 141 | 114 | 27 | 9 |

### 4-2. PDF由来アクティブの内訳

| 項目 | 件数 | 備考 |
|------|------|------|
| **遡及対象**（sourceType=NULL, active） | **4,204** | 全件 Drive PDF あり |
| うち extractedText あり | 4,185 (99.5%) | AI評価可能 |
| うち extractedText なし | 19 (0.5%) | OCR失敗・画像PDF等 |
| externalJobRef 設定済み | **0** | job-platformとの紐付け実績なし |

### 4-3. 月間フロー（直近30日）

| 指標 | 件数 |
|------|------|
| **PDF由来アップ** | **1,996件** |
| job-platform由来 | 141件 |
| 合計 | 2,137件 |
| PDF由来の候補者数 | 97人 |
| **日平均PDF由来** | **約67件/日** |

### 4-4. 直近14日の日別推移（PDF由来）

| 日付(JST) | 件数 |
|-----------|------|
| 07/03 | 1 |
| 07/02 | 9 |
| 07/01 | 58 |
| 06/30 | 24 |
| 06/29 | 106 |
| 06/28 | 25 |
| 06/27 | 57 |
| 06/26 | 62 |
| 06/25 | 178 |
| 06/24 | 66 |
| 06/23 | 172 |
| 06/22 | 145 |
| 06/21 | 26 |
| 06/20 | 50 |

### 4-5. AI費用の見積もり指標

- **遡及対象（既存）**: 4,204件。うち extractedText あり 4,185件がパイプライン投入可。
- **月間新規**: 約2,000件/月。
- **1件あたりの抽出費用**: job-platform 側調査①で算出予定。仮に $0.02/件 なら遡及 $84 + 月間 $40。

---

## 5. まとめ

### 5-1. portal 側の変更ファイル一覧

| ファイル | 変更内容 | Phase |
|---------|---------|-------|
| `prisma/schema.prisma` | `platformSubmittedAt` 列追加 | P1 |
| `src/app/api/candidates/[candidateId]/bookmarks/extract-text/route.ts` | テキスト抽出成功後にjob-platform非同期投入 | P1 |
| `src/app/api/external/bookmarks/platform-result/route.ts` | **新設**: webhook受信→externalJobRef設定 | P1 |
| `src/app/api/external/candidate-site/favorites/route.ts` | GET: sourceJobId（externalJobRef）ありの行はフルデータURL返却 | P2 |
| `src/components/candidates/HistoryTab.tsx` | フルデータ化ステータス表示（バッジ等） | P2 |
| `scripts/t131-backfill-platform-submit.ts` | **新設**: 既存4,185件の遡及投入 | P1バッチ |

### 5-2. Phase分割案

| Phase | 内容 | 前提 |
|-------|------|------|
| **P0（本調査）** | portal側接続点調査（本レポート）+ job-platform側調査① | ✅完了 |
| **P1: パイプライン接続** | extract-text 後の非同期投入 + webhook受信 + platformSubmittedAt 列 | job-platform 抽出API が ready |
| **P1-batch: 遡及投入** | 既存 4,185件を dry-run→CSV→ID限定バッチ投入 | P1 deploy 後 |
| **P2: 求職者サイト表示** | favorites GET でフルデータURLを返却 + 求職者サイト側の詳細画面表示 | job-platform 詳細ページ API ready |
| **P3: UI表示** | portal上でフルデータ化ステータスバッジ + リトライUI（任意） | P1 deploy 後 |

### 5-3. リスク評価

| リスク | 評価 | 対策 |
|--------|------|------|
| **CAのUX変化** | **なし** | 全操作が非同期。アップロード画面・求人出力・AI評価いずれも不変。CAの操作は1つも増えない |
| **既存フロー破壊** | **なし** | job-platform投入は fire-and-forget の追加層。失敗しても CandidateFile は従来どおり動作 |
| **kyuujinPDF二重登録** | **低** | 当面は両方に投入。kyuujinPDF側は求人出力・マイページ・対象外管理で引き続き必要 |
| **遡及コスト** | **中** | 4,185件 × 抽出費用。job-platform側調査で1件単価を算出後に判断 |
| **抽出失敗率** | **要検証** | OCR失敗19件(0.5%)は投入対象外。パイプライン側の失敗率は別途計測 |
| **sourceJobId の一意性** | **低** | externalJobRef（既存フィールド）を流用。PDF由来は現在全件NULL＝衝突なし |
| **platformSubmittedAt の二重投入** | **低** | 投入済みフラグで防止。webhook が externalJobRef を設定するまで再投入しない |

### 5-4. 要確認事項

1. **job-platform 側の抽出API仕様**: 投入エンドポイント・レスポンス・webhook payload の確定（job-platform側調査①の結果待ち）。
2. **1件あたりの抽出費用**: 遡及4,185件 + 月間2,000件の費用概算。
3. **求職者サイトでの表示仕様**: フルデータ非公開求人の詳細画面デザイン（既存HITO-Link求人と同一テンプレートか・独自か）。
4. **kyuujinPDF二重登録の長期方針**: 将来的にkyuujinPDF登録を廃止するか、永続的に二重登録を維持するか。

---

*本レポートはコード読み取り＋本番DBへのSELECTのみで作成。アプリコード変更・本番データ書き込みは行っていない。*
