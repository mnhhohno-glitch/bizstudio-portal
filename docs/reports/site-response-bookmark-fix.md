# サイト応募ブックマーク修正 報告書

対応日: 2026-07-11 / コミット: `4d2900f`（Railway 本番 `bizstudio-portal` = SUCCESS）
関連: 2026-07-06 将幸さん報告「/site/ 応募がCA画面のブックマークに載らない」の調査結果を受けた修正。

## 不具合の本体（調査で確定済み）

- **旧マイページ（/v/・kyuujin）経由**の「応募したい/気になる」は `candidate-response` webhook が
  `CandidateJobResponse` ＋タスクは作るが **`CandidateFile`（BOOKMARK行）を作らない**ため、CA管理画面
  「紹介履歴 > ブックマーク」に永久に出ず、CAが求人を検索して手作業で引き当て直していた。
- 新サイト（/site/）経由はブックマークが正しく作られる（後述 Task 0 で再確認）。

---

## Task 0: 新サイト応募のタスク発火 実測（白黒）

テスト候補者 5999999 で /site/ 応募フロー（apply → favorites → response-status）を実行し観測:

| 生成物 | 結果 |
|---|---|
| ① ブックマーク（CandidateFile BOOKMARK） | **作成される**（origin="candidate" / responseStatus=APPLY / archivedAt=null）→ CA画面に出る |
| ② CandidateJobResponse | 作成されない（favorites行の kyuujinJobId=null のため同期対象外） |
| ③ マイページ回答タスク | **生成されない** |
| ④ LINE WORKS 応募通知 | **送信される**（notified=true） |

**結論: 「疑い」は現象としては確認されたが、不具合ではない。**
- /site/ 応募のブックマークは正しく作られる（本不具合＝旧マイページ経路の話であり /site/ ではない）。
- CAへの通知は「📮 求職者が求人に応募しました」の **LINE WORKS 応募通知**（T-128 T2 の設計）で担保されている。
  マイページ回答タスクは旧webhook経路（kyuujinJobId あり）の別機構で、/site/ 応募で無理に生成すると
  応募通知と二重通知になる。→ **修正不要**。テストデータは掃除済み。

---

## Task 1: 旧マイページ応募でもブックマーク自動作成

`candidate-response` webhook（`src/app/api/external/candidate-response/route.ts`）に、回答同期・タスク生成の
**既存処理を一切変えず**、台帳確保処理を追加（`src/lib/mypage-response-sync.ts` の
`ensureBookmarkForMypageResponse`）。

- 同一候補者×同一 `kyuujinJobId` の BOOKMARK 行が**無ければ**新規作成、**あれば何もしない**（冪等）。
  一意制約 `@@unique([candidateId, kyuujinJobId])` はアーカイブ行も含むため `archivedAt` 問わず存在確認
  （CAが意図的にアーカイブした行を復活させない）。
- 作成フィールド: `category="BOOKMARK"` / `origin="candidate"` / `kyuujinJobId=payload.jobId` /
  `externalJobRef=null` / `sourceType=null`（legacy kyuujin ブックマーク慣例） /
  `responseStatus`=(WANT_TO_APPLY→APPLY, INTERESTED→INTERESTED) /
  `responseStatusUpdatedAt`=`responseSubmittedAt`=`respondedAt`（旧由来＝送信済み扱い・偽の未送信差分を作らない） /
  `fileName="求人票_{会社名}.pdf"`（会社名は kyuujin から best-effort・不能時は求人IDで代替） /
  `uploadedByUserId`=システムユーザー(anonymous@local)。
- `fetchJobMap` を `fetchCandidateJobsMap` へ内部リファクタ（出力不変・タスク本文生成は挙動不変）。

## Task 2: 「登録者（担当）」欄に「サイト経由」表示

- CA画面 `HistoryTab.tsx` のブックマーク一覧「担当」列: `origin==="candidate"` の行を緑字
  **「サイト経由」** と表示（従来 "Anonymous" を置換）。CA追加行（origin=null|"ca"）は従来どおり
  `uploadedBy.name`（例: 「安藤 嘉富」）を表示。ソート用 accessor も同様に補正。
- files API（`src/app/api/candidates/[candidateId]/files/route.ts`）の `select` に `origin` を追加。
- Task 1 で作られる旧マイページ由来の行も origin="candidate" のため「サイト経由」表示になる。

## Task 3: 支援中の過去分救済（新規行の作成のみ）

`scripts/backfill-site-response-bookmarks.ts`（dry-run 既定・`--execute`・ACTIVE 限定）。

- 対象: `CandidateJobResponse`（WANT_TO_APPLY/INTERESTED）があるのに、同一候補者×同一 kyuujinJobId の
  BOOKMARK が**一切無い**もの（archivedAt 問わず）× 候補者 `supportStatus="ACTIVE"`。
- **dry-run 結果**: 対象CJR 501件 / 既存BOOKMARKありスキップ 412件 / **救済対象 89件**
  （APPLY 45・INTERESTED 44・対象候補者 19名）。plan CSV 全量を `verify/` に保存。
  重複 `(candidate, kyuujinJobId)` ペア 0（89行=89ユニーク）→ 一意制約違反なし・異常なし。
- **execute 結果**: **作成 89 件 / 失敗 0 件**。rollback CSV（作成 CandidateFile.id 一覧）を `verify/` に保存。
- **冪等確認**: 再 dry-run で救済対象 **0 件**（501件すべて BOOKMARK 保有）。
- 巻き戻し: rollback CSV の `candidateFileId` を DELETE すれば完結（新規行のみ・既存値の上書き/DELETE なし）。

CSV（`verify/`）:
- `site-response-bookmark-backfill-dryrun-20260711-0627.csv`（dry-run 全量）
- `site-response-bookmark-backfill-execute-20260711-0635.csv`（execute 対象）
- `site-response-bookmark-backfill-rollback-20260711-0635.csv`（rollback 用・作成89件のID）

## Task 4: 動作確認（7点）

| # | 確認内容 | 結果 |
|---|---|---|
| 1 | 旧webhook（テスト5999999）→ BOOKMARK自動作成・origin=candidate・既存CJR/タスクも生成 | ✅（bookmark 1行 / CJR / タスク【マイページ回答】生成を確認） |
| 2 | 同一求人に再回答 → 行が二重に作られない（冪等） | ✅（BOOKMARK 1行のまま） |
| 3 | /site/ 応募行が origin=candidate（=「サイト経由」対象） | ✅（Task 0 の favorite 行 origin=candidate） |
| 4 | CA追加行の担当表示が従来どおり | ✅（6/16 CA追加行が「安藤 嘉富」表示・スクショ） |
| 5 | 救済後、ACTIVE候補者のブックマークが出現し「サイト経由」表示 | ✅（馬場頌悟 ブックマーク 15→34・7/11行が「サイト経由」・スクショ） |
| 6 | 救済の再 dry-run で対象 0 件 | ✅ |
| 7 | テストデータ掃除 | ✅（Task 0/Task 4 の一時行・CJR・タスクを削除。救済89行は正規の成果物として保持） |

データ確認: origin=candidate の active ブックマークは 32件 → **121件**（＝ +89 救済）。
旧マイページ形（origin=candidate / sourceType=null / externalJobRef=null / kyuujinJobId有）の active 行 = 89件（execute 件数と一致）。

## 影響・残課題

- 今後の旧マイページ回答は webhook が自動でブックマークを確保する（新規欠損の発生を防止）。
- 救済は方針どおり **ACTIVE 候補者のみ**。支援終了者の欠損（全体では別途 200件超）は対象外
  （`--all-candidates` で拡張可能・現状は運用不要と判断）。
- 旧マイページ行は `externalJobRef=null`（会社名照合系の求職者選択モードフラグの一部は未充填）。
  kyuujinJobId は保持しているためエントリー系橋渡し・CJR同期・CA画面表示は成立。externalJobRef は
  将来 T-133/T-131 系のバックフィル対象。
- 根本解決は T-133 P4（mypage BFF の portal ネイティブAPI切替）で全経路が portal 台帳に直接書くこと。
