# 05. bizstudio-mypage 仕様

求職者向けマイページのフロントエンド。Next.js / TypeScript / Vercel。

## リポジトリ情報

- リポジトリ: `mnhhohno-glitch/bizstudio-mypage`
- 本番: `mypage.bizstudio.co.jp` (Vercel)
- ブランチ: main 直 push 運用

## 役割

- フロントエンドのみ。**自前のDBは持たない**
- データは kyuujinPDF API から取得して表示
- 求職者の操作（気になる/応募したい）は kyuujinPDF へ送信

## 表示ステータスの分類

| カテゴリ | 内部値 |
|--|--|
| 未回答 | `none` |
| 気になる | `interested` |
| 応募したい | `apply` |
| 保留 | `pending` |
| 対象外 | `excluded` |

## タブ件数とフッター件数の集計（Phase B 修正後）

全部 `status` ベースで統一済み。is_submitted は無視。
