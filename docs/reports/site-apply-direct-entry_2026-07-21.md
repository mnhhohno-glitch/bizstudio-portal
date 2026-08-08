# サイト経由レコードをブックマークから直接エントリー登録 — 完了報告

- 実施日: 2026-07-21（JST）
- 対象: bizstudio-portal（staging 検証 → master 本番）
- 種別: 新規API追加 + UI導線追加 + 既存分岐の切り離し + 本番データ修正（null 戻し）
- 関連: `e4a5493`（サイト経由 linkOnly 経路の導入）、`7871a28`（フラグ不整合調査）

## 0. コミットID

| ブランチ | コミット | 内容 |
|--|--|--|
| staging | **`94cf887`** | feat: サイト経由レコードをブックマークから直接エントリー登録／求人紹介へ移動から切り離し |
| master | **`94cf887`**（staging を fast-forward マージ） | 同上（本番反映） |

- staging デプロイ: **SUCCESS**（BUILDING→DEPLOYING→SUCCESS、待機97s）
- master/本番デプロイ: **SUCCESS**（同、待機134s）

## 1. to-entry API の実装箇所と流用ロジック

- 新規: `src/app/api/candidates/[candidateId]/bookmarks/to-entry/route.ts`（POST）
- リクエスト: `{ fileIds: string[], entryDate?: string }`
- 対象を**サーバー側で厳格に限定**: `candidateId` 一致 かつ `category="BOOKMARK"` かつ `driveFileId=null` かつ `origin="candidate"` かつ `archivedAt=null`。それ以外の id は弾き、件数を `rejected` で返す。
- 各レコードから JobEntry を生成（`prisma.jobEntry.createMany`）:
  - `companyName` = `stripFileMetadata(fileName)`
  - `jobDb` = `resolveJobDbFromBookmark(sourceType, sourceMedia)`（null時は `resolveBookmarkMedia` フォールバック）
  - `externalJobNo` = `extractJobNoFromRef(externalJobRef)`
  - `externalJobId` = 0 / `jobTitle` = "" / `entryFlag` = "エントリー" / `entryFlagDetail` = "検討中"
  - `route` = "site-apply"（最終形の「求人応募」タブ分離用マーカー）
  - `entryDate` = 指定日 / `introducedAt` = 実行時刻 / `careerAdvisorId`・`createdBy` = 実行ユーザー
- **流用**: 既存 `POST /api/entries` のエントリー作成データ形（`externalJobId=0`・kyuujin/CandidateFile 参照なし・`entryFlag`/`entryFlagDetail` 既定）をそのまま踏襲。既存 `/api/entries` は無変更。
- **二重登録防止**: 当該候補者の既存 JobEntry.companyName 集合と照合し、既存＝スキップ、バッチ内同名も1件に集約。`created`/`skipped`/`rejected` を返す。
- **サブステータス再計算**: `/api/entries` POST と同じく呼ばない（手動エントリー作成と挙動一致）。

## 2. 「エントリーへ登録」ボタンの有効条件と EntryDateModal 流用

- 追加場所: `HistoryTab.tsx` ブックマーク選択アクションバー（「求人紹介へ移動」の右）。
- **有効条件**: 選択中に `origin="candidate"` かつ `driveFileId=null` のファイルが1件以上あるとき表示。ボタン文言に対象件数を表示（例「➡ エントリーへ登録（14件）」）。
- **EntryDateModal 流用: 可**。求人紹介→エントリーで使う既存 `EntryDateModal`（count/onConfirm/onCancel）をそのまま BookmarkSection 内でも描画。日付選択→ to-entry 呼び出し。
- 成功後: `onEntryCreated`（= HistoryTab の `fetchEntries`）でエントリー一覧を再取得。トースト「N件をエントリーに登録、M件は登録済みのためスキップしました」。既存のエントリー作成成功時と同じ更新パターン。

## 3. 求人紹介へ移動からの切り離し方法 / linkOnly 分岐の扱い

- `handleMoveToJobs`（📋 求人紹介へ移動）で、`origin="candidate"` かつ `driveFileId=null` を**移動対象から除外**（＝ `last_exported_at` を立てない）。
- **案内方式**: 除外したサイト経由が存在する場合、情報トースト「サイト応募N件は移動対象外です。「エントリーへ登録」から進めてください」を表示。通常PDF行のみ従来通り restore-jobs / send-to-job-tool に振り分け。
- 移動可能な通常行が0件のときは API を呼ばず、同案内トーストのみ表示して早期 return。
- **linkOnly 分岐は残置**。`send-to-job-tool` は `handleMoveToJobs` に加え **`handleSendToJobTool`（📤 求人出力へ送信）からも `selectedIds` 全件で呼ばれる**ため（`HistoryTab.tsx:1108`）、分岐を消すと求人出力側が壊れる。求人出力は「出力」なので `last_exported_at` を立てる挙動が妥当。したがって除去せず維持。
- e4a5493 の bulk-download（PDF未保管スキップ＋件数明示）と analyze-batch（サイト経由を対象外）は**無変更で残置**。

## 4. Task 4 データ修正（本番・railway ssh 経由）

- 経路: `railway ssh --service bizstudio-portal` → コンテナ内 Node + `pg`（`DATABASE_URL`）。`railway run` 不使用。
- **事前 SELECT（読み取り）**: `WHERE candidate_id='cmr2srwuf003k1dqlrq1k6t4v' AND origin='candidate' AND drive_file_id IS NULL`
  - `TOTAL_MATCH: 14`（**想定通り14件**）/ `WITH_last_exported_at_set: 14`（全件 `2026-07-21T01:55:43.497Z` / `hito-link`）/ `by_category: {BOOKMARK:14}` / `archived: 0`
  - 対象ファイル: SGフィルダー・Terra Drone・パーソルフィールドスタッフ・八幡電気産業・和泉運輸・小島屋乳業製菓・Nety・TMT・VRAIN Solution・アメニティ・イーエス・ウォーターネット・城山ビジネス・田中貴金属工業・田中電気（＝登録した14社と一致）
- **UPDATE 実行**: `SET last_exported_at=NULL, last_exported_to=NULL`（同 WHERE）
  - `UPDATED_ROWS: 14` / 再確認 `STILL_SET_after: 0`
- 視覚確認: 高田さんブックマークで「SGフィルダー」検索 → **出力済バッジが消滅**（未出力状態に復帰）を実画面で確認。

## 5. デグレ確認（通常の求人紹介経由レコード）

- 検証中、通常PDF行27件に対する「求人紹介へ移動」（既に全件出力済）が restore-jobs 経路で処理され、レスポンス「**既に有効: 27件**」＝除外なしの no-op。求人紹介件数は 28 のまま不変・エラーなし。通常行の挙動にデグレなし。
- 通常行の 出力済バッジ・「未出力を選択」フィルタは従来通り（サイト経由14件のみ Task 4 で未出力に戻り、通常行は出力済のまま）。

## 6. 動作確認（高田 凌 / 5008152、staging=本番同一DB）

| # | 項目 | 結果 |
|--|--|--|
| 1 | サイト経由選択→「エントリーへ登録」→日付選択→成功トースト | **OK**「14件をエントリーに登録しました」。ボタンは14件を正しくカウント |
| 2 | エントリー管理に entryFlag="エントリー" で並ぶ | **OK**。エントリー管理ボード「エントリー 1人（14件）」、全行フラグ=エントリー、SGフィルダー/Terra Drone 等14社・エントリー日 2026/07/21 |
| 3 | 再登録で二重に増えずスキップ件数表示 | **OK**「0件をエントリーに登録、14件は登録済みのためスキップしました」。エントリー(14) 不変 |
| 4 | 求人紹介へ移動でサイト経由が除外・last_exported_at 立たない | **OK**。除外トースト表示。Task 4 前後で 14件に新規 last_exported_at は付かず（元の印を null 化） |
| 5 | Task 4 後、出力済バッジ消滅・未出力に戻る | **OK**。SGフィルダー行の出力済バッジ消滅を実画面確認、DB も STILL_SET_after:0 |
| 6 | 通常の求人紹介経由レコードが従来通り | **OK**（デグレなし、§5） |

## 7. 想定と違った点・注意点

1. **【要判断】エントリーの求人DB(jobDb)が全件「HITO-Link」**: 指定通り `jobDb=resolveJobDbFromBookmark(sourceType, sourceMedia)` を採用。対象14件は `sourceType="job-platform"` かつ `sourceMedia` 未設定のため、同関数の job-platform フォールバック「HITO-Link」に落ちる（フォールバックの `resolveBookmarkMedia` は job-platform では発火しない）。一方**ブックマークの DB名列は接頭辞判定（`resolveBookmarkMedia`）で「Circus」等を表示**しており、同一レコードで表示が食い違う（例: SGフィルダー circus-kiwjza → ブックマーク「Circus」／エントリー「HITO-Link」）。
   - 仕様準拠だが、DB名の実態と乖離。エントリー側もブックマークと同じ接頭辞判定に揃えたい場合は、to-entry の jobDb 導出を `resolveBookmarkMedia(sourceMedia, externalJobRef)` 優先に変更＋既存14件の jobDb を更新する追修正が必要（要指示）。`jobDb` は CA が画面で編集も可能。
2. **externalJobNo は末尾数字抽出のため ref そのままの行あり**: `extractJobNoFromRef` は末尾連続数字を取るため、`circus-kiwjza` のように末尾が数字でない ref は ref 全体を返す。数値化できる ref（例 hl-ap-289566）は数字部を格納。
3. **worktree 構成に合わせた運用**: `staging` ブランチは portal-staging worktree に checkout 済みのため、portal-2 では checkout 不可。staging 作業は portal-staging（`git pull` で e4a5493 へ fast-forward 後に実装）、master マージは master worktree で実施。origin/staging は既に e4a5493 と同一だった。
4. **検証中の誤操作（無害・確定）**: 動作確認の初回クリックで座標が「求人紹介へ移動」に当たり `handleMoveToJobs` が発火。ただし ①サイト経由14件は Task 3 で除外され last_exported_at 不変、②通常27件は全て既出力→restore-jobs 経路「既に有効: 27件」の no-op（PDF再アップロード・mypageコメント送信・新規求人紹介生成なし、求人紹介件数28不変）。実害なし。以降は要素 ref 指定でクリックし再発防止。

## 8. ロールバック

- コード: `git revert 94cf887` → `py scripts/wait_railway_idle.py` → `git push origin master`（staging も同 revert を push）。
- データ: 作成した14件のエントリーを戻す場合は、エントリー管理の各行「戻す」またはエントリー削除API（`DELETE /api/candidates/[id]/entries/[entryId]`）。Task 4 の last_exported_at は null 化済み（元値 2026-07-21T01:55:43.497Z/hito-link は e4a5493 の副作用値であり復元不要）。

## 9. AI（Gemini/Claude）不使用・コスト

- 追加処理は DB 読み書きとフロント表示のみ。AI 呼び出しなし。**費用 ¥0**。
