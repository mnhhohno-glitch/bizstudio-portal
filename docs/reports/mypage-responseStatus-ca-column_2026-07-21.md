# 修正1: CA画面に本人回答（responseStatus）列を追加 — 完了報告

- 実施日: 2026-07-21（JST）
- 対象: bizstudio-portal（portal-1 / master）
- 種別: 表示のみの追加（既にDBにある `CandidateFile.responseStatus` を読んで表示）。DB書き込み・移行・同期なし。
- 関連調査: `7871a28`（mypage フラグ不整合調査）

## 1. コミットID

- **`129dcbc`** feat(candidates): show candidate responseStatus column in bookmark list
- 報告書コミット（本ファイル）は別途。

## 2. Railway デプロイ結果

**SUCCESS（Ready）**。ビルド遷移 BUILDING → DEPLOYING → SUCCESS（待機132s）を実測確認。push 前に `wait_railway_idle.py` で idle 確認、push 後に再度 idle=SUCCESS を確認。

## 3. 変更したファイル

| ファイル | 変更 |
|--|--|
| `src/app/api/candidates/[candidateId]/files/route.ts` | select に `responseStatus: true` を追加（+2行）。後方互換（フィールド追加のみ・既存の削除/改名なし） |
| `src/components/candidates/HistoryTab.tsx` | ①`RESPONSE_STATUS_BADGE` 定数追加 ②`BookmarkFile` 型に `responseStatus?` 追加 ③ヘッダに「本人回答」列 ④行セルに本人回答バッジ（+31行） |

- `.claude/scheduled_tasks.lock` の削除はセッション開始時点からの既存差分。**本コミットには含めていない**（明示パス add のみ）。
- 変更禁止ファイル・マイページ・job-platform は一切触っていない。

## 4. 列の配置と並び替え

- **配置**: 「総合」の右・「担当」の左（希望｜通過｜総合｜**本人回答**｜担当｜紹介日）。CAが評価3軸と本人回答を横並びで見られる位置。ヘッダ・セルとも幅 `w-[72px]` で整列。
- **並び替え**: **付けていない（省略）**。判断理由:
  - 既存の「表示順: 応募したい順／気になる順」ソートは**別テーブル `CandidateJobResponse`（`findJobResponse`）由来**であり、本列（`CandidateFile.responseStatus`）とは別系統。
  - responseStatus 用のソートを足すと「応募したい」概念が2系統併存して混乱を招き、かつ既存の2段クロスソート（`SortBasis`/`makeCompositeComparator`）モデルへの侵襲が大きい。中心業務画面へのリスクを避けるため見送り。
  - 応募ストアの整理（CandidateJobResponse / CandidateFile.responseStatus の統合方針）は**修正3**で扱う前提のため、本タスクは列の追加のみに限定。
- **値マッピング**（`CandidateFile.responseStatus` の正準値ベース。※タスク表の `WANT_TO_APPLY` は `CandidateJobResponse` 用語で、CandidateFile 側の実値は **`APPLY`**）:
  - `APPLY`→応募したい（赤）/ `INTERESTED`→気になる（黄）/ `PENDING`→保留（グレー）/ `EXCLUDED`→対象外（薄グレー）/ `IN_SELECTION`→選考中（青）/ `SELECTION_ENDED`→選考終了（グレー）/ `UNANSWERED`・null・不明→「—」
  - 色は既存バッジ配色を流用（新色を作り込まない）。内部値（APPLY 等）は画面に出さず必ず日本語表示。

## 5. 動作確認 1〜8（本番・実測）

| # | 項目 | 結果 |
|--|--|--|
| 1 | 高田 凌(5008152) の「本人回答」列に 応募したい12・気になる3 が見える | **OK**。サイト経由行に 応募したい（SGフィルダー/パーソル/TMT/VRAIN/アメニティ/イーエス/城山 等）・気になる（Terra Drone/Nety）を実画面で確認 |
| 2 | 日本語表示（内部値 APPLY 等が出ていない） | **OK**。「応募したい」「気になる」表示。内部値なし |
| 3 | 未回答の行が「—」 | **OK**。CA投入PDF行（responseStatus=null）は「—」 |
| 4 | 大野テスト(5999999) でも表示 | **OK**。サイト経由行に 応募したい/気になる、自社(CA)行は「—」を確認 |
| 5 | 既存列（DB名〜紹介日）の表示・並び替えが従来どおり | **OK**。希望/通過/総合(A/B/C/D)・担当・紹介日いずれも従来表示。列整列も崩れなし |
| 6 | 「応募したい順／気になる順」ボタンが従来どおり | **OK**。クリックしてもエラーなく一覧描画。ソートロジックは未変更 |
| 7 | 表示速度の体感悪化なし | **OK**。既存フィールドの追加取得のみで体感変化なし |
| 8 | マイページ(/site) が従来どおり | **OK（範囲による確定）**。マイページ repo・candidate-site favorites API は未変更。portal の files API/HistoryTab のみの変更のため /site への影響経路なし |

## 6. 155件問題の解消確認

高田さんの求職者詳細ブックマーク一覧で、これまでCA側で完全に不可視だった本人回答が「本人回答」列に表示されることを実画面で確認:
- 応募したい（APPLY）12件・気になる（INTERESTED）3件が列に出現（サイト経由行）。
- 従来はこの列自体が存在せず、CAが見ていた「気になる/応募したい」チップは別テーブル `CandidateJobResponse`（高田さんは0件）由来のため空だった。本修正で `CandidateFile.responseStatus` が直接可視化された。
- systemic には ACTIVE 29名/155行（INTERESTED 92・APPLY 63）が同じ経路で可視化される。

## 7. AI（Gemini / Claude）不使用の確認

**1回も呼んでいない。** 追加した処理は既存 `CandidateFile.responseStatus` の select 追加とフロントの表示のみ。AI呼び出しコード・プロンプトの実行/追加なし。費用¥0。

## 8. マイページ・job-platform 不変更の確認

- 変更は portal の2ファイルのみ（files API・HistoryTab）。
- `C:\bizstudio-mypage`（マイページ repo）・job-platform（Supabase）には一切アクセス・変更していない。
- portal 側の candidate-site（favorites / apply / response-status 等）API も未変更。

## 9. ロールバック方法

- `git revert 129dcbc` → `py scripts/wait_railway_idle.py` → `git push origin master`。
- 表示のみの追加のためデータ影響なし。revert で列と select 追加が消え、従来表示に戻る。

## 10. 想定と違った点・注意点

1. **値は `APPLY`（`WANT_TO_APPLY` ではない）**: タスク指示表は `CandidateJobResponse` 用語の `WANT_TO_APPLY` を記載していたが、CA画面が読むのは `CandidateFile.responseStatus` で、応募したいの実値は **`APPLY`**。実値に合わせて APPLY→応募したい とマップ（防御的に WANT_TO_APPLY は使わず APPLY を採用。DBの高田さんデータで APPLY を実測確認済み）。
2. **IN_SELECTION / SELECTION_ENDED も表示対象に含めた**: タスク表には5状態のみ記載だったが、`responseStatus` は正準値として IN_SELECTION/SELECTION_ENDED（CA駆動READONLY）も取りうる。これらを「—」に落とすと誤解を招くため、選考中/選考終了として控えめ表示。
3. **既存の「気になる/応募したい」チップ（会社名脇）は別物・残置**: `CandidateJobResponse` 由来のチップ（`RESPONSE_BADGE`）はそのまま。新「本人回答」列（`CandidateFile.responseStatus`）と併存し、大野テストでは両方表示されることを確認（別系統のため干渉なし）。両者の統合・整理は修正3の範囲。
4. 希望/通過/総合の「—」は本タスク対象外（サイト経由行に aiMatchRating が無いため）。本修正では触れていない。
