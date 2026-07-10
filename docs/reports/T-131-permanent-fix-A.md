# T-131 恒久修正-A: 投入の消失耐性＋二重発火修正＋拾い直しの定期自動化

対応日: 2026-07-11 / コミット: `8991612` / Railway 本番 `bizstudio-portal` = **SUCCESS**（commit一致確認済み）
背景: FU-8 調査で確定した「job-platform 投入の無言消失（at-most-once）」と「extract-text の二重発火による重複求人」の恒久修正。

## セマンティクス変更の明記（重要）

`CandidateFile.platformSubmittedAt` の意味を **「投入試行後の時刻」→「投入クレーム時刻（＝試行開始時刻・HTTP送信の前に打つ）」** に変更した。
- これにより、送信中/直後にプロセスが死んでも `platformSubmittedAt あり・externalJobRef なし` の痕跡が残り、
  拾い直しの対象になる（**at-most-once → at-least-once 化**）。
- 拾い直しの30分ゲートは従来どおり `platformSubmittedAt`（今後はクレーム時刻）を基準に効く。挙動の連続性は保たれる。
- **既存データ（旧「試行後に打つ」方式で書かれた行）への遡及書き換えはしない**（前方互換・自然に新方式へ移行）。

## 変更内容（3点）

### 1. 投入前クレーム方式（消失耐性＋二重発火の排他）— `src/lib/job-platform-ingest.ts`
`ingestAndLink` を、**HTTP送信の前に** `updateMany({ where: { id, platformSubmittedAt: null, externalJobRef: null }, data: { platformSubmittedAt: now } })` でクレームする方式へ変更。
- 更新0件（＝他プロセスが既にクレーム済み＝二重発火）ならその行の投入をスキップ（`skipped:true` を返す・job-platform に重複を作らない）。
- 成功時は従来どおり `externalJobRef` を書き戻す。失敗時はクレーム時刻をそのまま残す（externalJobRef=null のまま＝拾い直し対象）。
- job-platform 側の内容ハッシュ dedup と合わせ二重防御。

### 2. 拾い直しの整合＋共有化 — `src/lib/t131-resubmit-stale.ts`（新規）/ `scripts/t131-resubmit-stale.ts`
本体を `runResubmitStale()` に集約（手動スクリプトと定期APIで共有）。滞留判定 = `externalJobRef=null` かつ（`platformSubmittedAt=null` または30分以上前）。
- **拾う際に再クレーム**（同条件の `updateMany` で `platformSubmittedAt=now`）してから再送信。更新0件なら他プロセス（別cron実行・手動実行）が先着したものとしてスキップ＝二重送信の排他。
- 既定 DRY-RUN／`--execute`・単一実行・上限件数の挙動は維持。スクリプトは薄いラッパへ。

### 3. 二重発火の修正 — `src/components/candidates/HistoryTab.tsx`
`uploadFiles` で `fetchFiles()` を呼ぶ**前に** `extractTriggered.current = true` を立てる（FU-8特定の1行修正）。
アップロード直後の `fetchFiles()` による `files` 更新で「未抽出キャッチアップ effect」が `:upload` トリガーと併走して同じ求人を2回 extract→投入する問題を止める。アップ分は `:upload` 経路のみで1回だけ抽出される。

### 定期自動化 — `src/app/api/internal/bookmarks/resubmit-stale/route.ts`（新規）＋ `.github/workflows/t131-resubmit-stale.yml`（新規）
- API: `POST /api/internal/bookmarks/resubmit-stale?dry_run=&confirm=&batch=`。認証 `x-api-key`＝`INTERNAL_API_KEY`（auto-expire と同一鍵）。二段ガード（本番再投入は `dry_run=false&confirm=true`）。HTTP境界に収めるため既定 `batchCap=10`。対象0件時は何もしない。
- cron: **2時間毎**（`0 */2 * * *`）に本番へ `dry_run=false&confirm=true` で実行。`workflow_dispatch` で手動疎通も可。実行件数・各件の成否は Actions ログに残る。auto-expire-daily.yml の実績パターンに準拠。

## シークレット登録（将幸さんの手作業）: **不要**
本cronは既存の GitHub Secret `INTERNAL_API_KEY`（auto-expire で使用中）をそのまま流用。本番 `bizstudio-portal` サービスにも `INTERNAL_API_KEY` / `INTERNAL_INGEST_API_KEY` / `GOOGLE_SERVICE_ACCOUNT_KEY` が設定済みであることを確認済み。**新規のシークレット登録は必要ありません。**

## 動作確認（5点）

| # | 確認内容 | 結果 |
|---|---|---|
| 1 | アップロード時に extract/投入が **各1回だけ** 発火 | ✅ 実UI（React uploadFiles）を合成 File で発火させ、`/bookmarks/extract-text` の POST が**1回のみ**であることをネットワークで確認（修正前は2回）。11秒後もキャッチアップ effect の2回目は発火せず |
| 2 | クレームの排他（二重発火→片方スキップ） | ✅ ingestAndLink と同一のクレーム `updateMany` を2連打同時発火 → 片方 count=1（送信）/ 片方 count=0（スキップ） |
| 3 | 疑似消失（externalJobRef=null・platformSubmittedAt=31分前）を拾い直し | ✅（機構）dry-run が対象を検出（stale 7→8・当該fileId拾上げ）→ execute batch=1 が当該行を選択→再クレーム→Drive取得→job-platform送信まで実行。※最終の externalJobRef 付与は **job-platform 側の Gemini クォータ枯渇（HTTP 422）** により未達だが、失敗時に platformSubmittedAt を再クレームして externalJobRef=null を保持＝次回リトライへ回す挙動（at-least-once）が正しく動作。まさにこの安全網が存在する理由 |
| 4 | 定期実行（手動トリガー）が成功しログが残る | ✅ `gh workflow run`（dry_run=true）→ run 成功 → 本番APIを叩き HTTP 200 → summary `mode=DRY-RUN candidates=7 stale=7 processed=0` を Actions ログに出力。対象0件時は processed=0＝何もしない |
| 5 | テストデータ掃除 | ✅ `__t131-*` テスト行・Drive実体・疑似消失行を全削除（残0件） |

補足: 本番には実際に **7件の滞留行**（7/08〜7/10 に inline 投入が失敗し externalJobRef=null で放置＝旧 at-most-once の被害）が存在。これらは今回の cron が2時間毎に拾い直し、job-platform 側 Gemini クォータ回復後に自動で externalJobRef が付与される（＝本恒久修正が現に必要だった証跡）。

## 影響・留意
- 追記的変更のみ（既存値の上書き・DELETE なし）。既存の投入済み行・手動スクリプトの互換は維持。
- job-platform の Gemini クォータ枯渇（422）は外部要因の一過性。resubmit の再クレーム＋30分ゲートでリトライされ、回復すれば自動収束する。
