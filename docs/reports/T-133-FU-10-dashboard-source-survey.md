# T-133 FU-10 調査報告: ダッシュボード数値の読み元特定と合算設計（停止＝設計判断要求）

対象: `src/app/api/candidates/[candidateId]/dashboard/route.ts`（UIの `DashboardTab.tsx` は本APIを読むだけ）
日付: 2026-07-06 / 状態: **Task 1(調査)完了・Task 2(実装)は停止条件①で保留（設計判断が必要）**

## 結論サマリ

1. マイページ**反応（気になる/応募したい/未回答）と気になる件数・応募したい件数**は、旧テーブル `CandidateJobResponse` を読んでおり、新 /site/ が書く新台帳 `CandidateFile.responseStatus` を見ていない。これが症状の原因。
2. ただし要件の前提「P5移行で旧の過去分は新台帳に複製済み＝新台帳を読むだけで旧＋新の合算」は**実データで成立しない**。**新台帳だけ読むと80名（うちACTIVE 22名）で反応が過少表示になる**（旧のみに残る過去分が落ちる）。単純な読み替えはデータ消失を招く。
3. **閲覧系（最終ログイン・閲覧回数・閲覧の動きグラフ）は新サイトの活動が portal にもkyuujinにも一切記録されていない**。新サイトのログイン（kyuujin `verify`）は access_count を増やさず、閲覧記録用テーブルも portal に無い。→ 記録の新設はスコープ外のため実装しない（Task 2-2 の停止事由）。

## Task 1: 指標別の読み元一覧

| 指標 | 現在の読み元 | 新旧判定 | 新サイト活動を反映するか |
|---|---|---|---|
| マイページ反応ドーナツ（未回答/気になる/応募したい） | `CandidateJobResponse`（旧）＋母数は `CandidateFile` count | **旧のみ（要修正）** | ほぼ反映されない（移行分・kyuujinJobId無しは落ちる） |
| 気になる求人数 | `CandidateJobResponse` INTERESTED（旧） | **旧のみ（要修正）** | 同上 |
| 応募したい求人数 | `CandidateJobResponse` WANT_TO_APPLY（旧） | **旧のみ（要修正）** | 同上 |
| マイページ反応の母数（total） | `CandidateFile` BOOKMARK×lastExportedAt≠null×非archived | portal内製 | 反映（送信で増える） |
| 最終ログイン日時 | kyuujin `by-job-seeker` `last_accessed_at` | **旧のみ・新記録なし** | ❌ 新サイトは記録しない |
| マイページ閲覧回数（累計） | kyuujin `access_count` | **旧のみ・新記録なし** | ❌ 新サイトは記録しない |
| マイページ閲覧の動き（日別グラフ） | kyuujin `views_daily_30d` | **旧のみ・新記録なし** | ❌ 新サイトは記録しない |
| 最終求人提案日 | `CandidateFile.lastExportedAt` と `JobEntry.entryDate` の新しい方 | portal内製 | 反映（CA送信で更新） |
| 求人配信数 | `CandidateFile` BOOKMARK×lastExportedAt≠null count | portal内製 | 反映 |
| 最終接触日 | 面談/メモ/ContactLog/BOOKMARK送信 の最新 | portal内製 | 反映 |
| 放置日数 | 最終接触日から算出 | portal内製 | 反映 |
| 次回連絡予定日 | `Candidate.nextContactAt`（無ければ面談次回/タスク期限） | portal内製 | 反映 |
| エントリー社数/選考中/ファネル/通過率/選考段階内訳 | `JobEntry` | portal内製・マイページ無関係 | — |

**→ 修正が必要なのは「反応3系（ドーナツ・気になる数・応募したい数）」のみ。閲覧系3つは新記録の仕組みが無く別対応。他は既に portal 内製で新旧どちらの活動でも更新される。**

## 根拠（コード）

- 新 /site/ の仕分け書込 `response-status/route.ts`: `CandidateFile.responseStatus` を更新し、**kyuujinJobId がある行のみ** `applyJobResponseIntent` で旧 `CandidateJobResponse` にも同期（INTERESTED/APPLY/UNANSWEREDのみ）。
- P5移行 `scripts/t133-migrate-box-b.ts`: 書込先は**新台帳カラムと `CandidateResponseSubmission` のみ**。**旧 `CandidateJobResponse` には一切書かない**。かつ対象は「ACTIVE候補者 × kyuujinJobId 非null × 箱Bにjob有」に限定。
- ダッシュボード `dashboard/route.ts` L130: `prisma.candidateJobResponse.groupBy(...)` で旧テーブルを集計。

## 実データ検証（本番・読み取りのみ）

反応データを持つ候補者 121名の「新台帳(job単位) vs 旧テーブル」比較:

- **新台帳 > 旧（ダッシュボードが過少表示＝現行の実害）**: 2名
- **旧 > 新台帳（新台帳だけ読むと過去分が消える）**: **80名（ACTIVE 22 / WAITING 7 / ENDED 51）**
- 一致: 39名

「旧の回答job」が新台帳でどう存在するかの内訳（`externalJobId` = `kyuujinJobId` は同一ID空間と確認済み。両者とも `applyJobResponseIntent(candidateId, kyuujinJobId)` 経由で書かれる）:

- **ケースB（新台帳に同jobの CandidateFile が無い＝旧のみ）: 306件（ACTIVE 83件）** ← 旧mページ時代にkyuujin求人へ回答したが portal に対応ブックマーク行が無い。ジョブ単位unionで旧を加算すれば保全（二重カウントなし）。
- ケースA一致（新台帳に同job有・新も回答）: 425件 ← union で1回だけ計上。
- ケースA整合ズレ（新台帳に同job有だが新は UNANSWERED/null・旧は回答）: 134件（**ACTIVE 6件**）← 唯一の設計判断ポイント。

サンプル: 坊田様 5008166（ACTIVE）新 APPLY=4 / 旧 WANT_TO_APPLY=4（一致）。大森様 5008089（ACTIVE）新 INTERESTED=4 / 旧 INTERESTED=4（一致・P5で全15行 responseStatus 付与済）。`cmn5f50lb…` 新 i1 / 旧 i12（ケースB主体で旧に多数）。

## なぜ単純な「新台帳読み替え」ではダメか

要件は「新台帳＝旧＋新」を仮定していたが、P5が移行したのは *portal に CandidateFile 行があり kyuujinJobId が紐付く ACTIVE 候補者* のみ。旧 `CandidateJobResponse` には *portal ブックマーク行を持たない kyuujin 求人への回答（ケースB 306件）* が残っており、これは新台帳に存在しない。よって新台帳のみ読むとこの過去分が消える（要件「過去分が消えるのは不可」に反する）。

## 提案設計（推奨・要承認）

**反応3系を「ジョブ単位 union（kyuujin job id をキー）」で算出する。**

1. 新台帳: BOOKMARK×lastExportedAt≠null×非archived の各行を `kyuujinJobId`（無ければ `file:<id>` の合成キー）でマップ化し responseStatus を持つ。
2. 旧テーブル: `CandidateJobResponse` の各 `externalJobId` について、**新台帳マップに同 job が無い場合のみ**旧の response を採用（＝ケースB保全・ケースA一致は二重計上しない）。
3. 最終 job 集合で INTERESTED / APPLY を数える。母数（ドーナツ total）も**「portal掲載ブックマーク ∪ 旧のみ回答job」**へ拡張し、未回答 = 母数 − 気になる − 応募したい が負にならないようにする。
4. 非ACTIVE等で新台帳が空でも、旧テーブルからケースBとして全て拾えるため**別途フォールバック分岐は不要**（unionが自然にフォールバックを内包）。

**二重カウント検証**: ケースA一致425件は新台帳優先で1回・旧は加算しない。ケースB306件は新台帳に無いので旧を1回。合計で各jobは高々1回。

**唯一の判断ポイント（ケースA整合ズレ・ACTIVE 6件）**:
- 案①（推奨・新が真実）: 新台帳優先。新が UNANSWERED なら「本人が取消済み」とみなし未回答。＝現在の仕分けに忠実。影響 ACTIVE 6 jobs のみ。
- 案②（過去最大保全）: 「旧か新のどちらかが回答なら回答」。取消済みでも過去回答を残す。要件「過去分を消さない」を最大限尊重するが、本人が外した求人が気になる/応募に残る違和感。

## 停止理由

要件の前提が実データで崩れ、合算方式（母数の再定義・ケースA整合ズレの優先順位）に設計判断が必要なため、停止条件①に従い実装前に停止。上記提案設計＋ケースA判断（案①/②）の承認を受けて実装に進む。

## 閲覧系の設計課題（Task 2-2）

新サイトの閲覧・ログインを記録する仕組みが portal にも kyuujin にも無い（`verify` は access_count 非加算・portal に閲覧ログ用テーブル無し）。現状のまま kyuujin を読めば旧mページ時代の閲覧は保全されるが、新サイトの閲覧・ログインは永続的に 0/— のまま。反映するには「新サイトのアクセス記録の新設（portal 側テーブル or kyuujin access_count 加算経路）」が必要で、これはスコープ外の新規設計。→ 記録新設の要否を別途判断されたい。
