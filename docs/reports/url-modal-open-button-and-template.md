# 求人サイトURL発行モーダル: 「URLを開く」ボタン追加＋案内文テンプレ差替 完了報告

## 概要

`IssueSiteTokenButton` の求人サイトURL発行モーダルに以下2点を実装。

1. 発行URL欄の右隣に「URLを開く」ボタンを追加（新規タブで開く）
2. 案内文テンプレを新仕様（非公開求人＆マイページ、ご利用方法6項目）へ差替
3. 併せてテキストエリア rows 拡張＋モーダル最大高＋縦スクロール対策

## コミット

| # | 短縮ハッシュ | 内容 |
|---|--|--|
| 1 | **d6a6c87** | feat(candidates): add open-url button and update mypage guide text in url modal |
| 2 | **6d1e49b** | fix(candidates): expand url modal textarea rows to fit full guide text without scroll |

（初回コミット後の実機確認で日本語行の折返しにより rows=11 では足りず、rows=16 に増やすフォローアップ）

## Railway デプロイ結果

いずれも **SUCCESS**（service=bizstudio-portal, status=SUCCESS）。
- d6a6c87: 待機 142s で SUCCESS
- 6d1e49b: 待機 122s で SUCCESS

## 変更ファイル

- `src/components/candidates/IssueSiteTokenButton.tsx`（1ファイルのみ）

## 動作確認結果（本番 / 下澤右京 5008190）

| # | 手順 | 結果 |
|---|--|--|
| 1 | 求職者詳細画面を開く | OK |
| 2 | 「求人サイトURLを発行」→ モーダル表示 | OK |
| 3 | 「URLを開く」→ 新規タブで求職者サイト（BizStudio 非公開求人サイト・生年月日ログイン画面）が開く。元モーダルは残る | OK（新規タブ URL=`https://mypage.bizstudio.co.jp/site/5008190-3o8j90av`、ログイン画面表示確認済） |
| 4 | 「URLをコピー」従来通り動作 | OK（既存挙動非改修） |
| 5 | 案内文テキストエリアに新テンプレ表示・`{URL}`が実URLに置換 | OK（`https://mypage.bizstudio.co.jp/site/5008190-3o8j90av` に置換確認） |
| 6 | 案内文がスクロールなしで全文表示 | OK（rows=16 で「メモや質問…」まで表示） |
| 7 | 「案内文をコピー」で新テンプレ全文がクリップボードに入る | OK（トースト「コピーしました: 案内文」表示確認） |
| 8 | 発行URLが未発行・空で「URLを開く」が押せない | OK（`disabled={!siteUrl}` 実装。実際は UI レイヤーで siteUrl=null の際はボタン群非表示のブロックに入る `{!loading && siteUrl && (...)}` ため二重ガード。loading/error/noBirthday 状態では別分岐UIが出る） |

## 案内文テンプレの所在

- `src/components/candidates/IssueSiteTokenButton.tsx` **L11-22**
  - `ANNOUNCEMENT_TEMPLATE` 定数（複数行文字列を `+` 連結で組み立て）
  - 埋め込み方式：現行踏襲の `{URL}` プレースホルダ → `buildAnnouncement(url)`（L26）で `.replace("{URL}", url)`

## 想定と違った点・注意点

1. **rows の設計**：新テンプレは11論理行だが、日本語の長い箇条書き行がテキストエリアの折り返しで2行になるため rows=11 では下部が見切れた。実装時に折返し込みで rows=16 に増やす必要があった（コミット2でフォロー）。
2. **モーダル本体の縦スクロール**：`max-h-[90vh] overflow-y-auto` を追加済。低解像度画面でもビューポート内に収まる。今回の動作確認画面（744px高）ではモーダル本体スクロールは発生せず、テキストエリア内スクロールもなし。
3. **「URLを開く」の disabled**：ボタンは `!loading && siteUrl && (...)` ブロック内に置かれるため実運用上 siteUrl は必ずある。それでもプロンプト要件通り `disabled={!siteUrl}` を明示付与し、`disabled:opacity-50 disabled:cursor-not-allowed` を追加。
4. **配色**：新色定義せず既存の Tailwind ユーティリティ（`border-gray-300 bg-white text-gray-700 hover:bg-gray-50`）でセカンダリ系グレー配色。青系「URLをコピー」と区別できる。

## 未変更（要件通り）

- 「URLをコピー」の挙動
- 「案内文をコピー」の挙動
- 「発行URL」入力欄
- モーダルレイアウト全体
- `/api/candidates/[candidateId]/issue-site-token` API
- スキーマ・DB
