# Phase 5b 実施レポート

実施日: 2026-04-19
ブランチ: staging

## 1. 実施内容サマリー

Phase 5aのプレースホルダを実際の面談フォームに置き換え。2カラムレイアウト（左: 面談基本情報+転職活動+職歴 / 右: 5タブ）、30秒自動保存、添付ファイルアップロード+AI解析を実装。

## 2. 新規作成したファイル（1ファイル）

| ファイル | 行数 | 機能 |
|---|---|---|
| `src/components/candidates/InterviewForm.tsx` | ~650行 | 面談フォーム本体（2カラム + 5タブ + 自動保存 + 添付管理） |

## 3. 改修したファイル（1ファイル）

| ファイル | 変更内容 |
|---|---|
| `src/components/candidates/InterviewHistoryTab.tsx` | プレースホルダを InterviewForm に置き換え |

## 4. フォーム仕様

### 左カラム（w-460px固定）

| セクション | フィールド数 | 内容 |
|---|---|---|
| 面談基本情報 | 10 | 日付/開始/終了/所要(自動)/手法/担当CA/種別/回数/結果/メモ |
| 転職活動状況 | 10 | AG利用/在籍/転職時期/活動期間/応募数/応募種別+各メモ |
| 学歴・職歴 | 12 | 学歴/卒業年月/企業名/在籍/事業内容/職種/退職理由3階層/転職軸+メモ |

### 右カラム（flex-1）5タブ

| タブ | フィールド数 | 内容 |
|---|---|---|
| 初期条件 | ~20 | 転職活動状況+学歴職歴+面談メモ一覧 |
| 希望条件 | ~30 | 職種/業種/エリア/年収/休日残業転勤/スキル(免許/語学/PC)/働き方/優先条件 |
| ランク評価 | 35 | 人物5項目+経歴5項目+条件5項目(各スコア+メモ)/3セクション小計/総合計/総合ランク |
| アクション | ~12 | 書類/LINE/求人送付/次回面談/フリーメモ/初回面談まとめ |
| 添付 | - | D&Dアップロード/一覧/AI解析ボタン/削除 |

### 自動保存

- 30秒ごとに `PATCH /api/interviews/:id/autosave` 呼び出し
- `autosaveToken` による楽観的ロック（409 Conflict時にトースト通知）
- ネットワークエラー時は `localStorage` にバックアップ
- `beforeunload` で未保存変更時に確認ダイアログ
- 「最終保存: N秒前」をリアルタイム表示

### 手動保存

- 右カラム下部の「保存」ボタン
- `PATCH /api/interviews/:id` でstatus="complete"として保存
- ランク評価の小計/総合計を自動計算してPATCH

### 添付ファイル管理

- ドラッグ&ドロップ + クリック選択でアップロード
- 対応形式: PDF, 画像, Word, Excel, CSV, テキスト (最大20MB)
- 各添付: ファイル名/種別/サイズ/日付/解析ステータスバッジ
- 「AI解析」ボタンで `POST /api/interviews/:id/attachments/:attachmentId/analyze`
- 解析ステータス: 未解析(gray)/解析中(yellow)/解析済(green)/失敗(red)
- 削除: Supabase Storage + DB同時削除

## 5. API連携

| API | メソッド | 用途 |
|---|---|---|
| `/api/interviews/:id` | GET | フォームデータ取得 |
| `/api/interviews/:id` | PATCH | 手動保存 |
| `/api/interviews/:id/autosave` | PATCH | 30秒自動保存 |
| `/api/interviews/:id/attachments` | GET/POST | 添付一覧/アップロード |
| `/api/interviews/:id/attachments/:id` | DELETE | 添付削除 |
| `/api/interviews/:id/attachments/:id/analyze` | POST | AI解析 |

## 6. ビルド結果

- `npm run build`: **成功**
- コンパイル時間: 20.8秒

## 7. 変更しなかったもの

- Prisma スキーマ: **変更なし**
- API: **変更なし**
- Phase 5a のヘッダ/タブナビ: **変更なし**（InterviewHistoryTabのプレースホルダのみ置換）
- 既存の `/interviews/new`, `/interviews/[id]`: **変更なし**（Phase 6で廃止）

## 8. Phase 5b 残課題

- [ ] AI解析結果のプレビューモード（フィールド差分表示 + 採用/却下チェック）
- [ ] 職歴の複数社対応（現在は1社分のみ、InterviewDetailスキーマ制約）
- [ ] 面談メモCRUD UI（現在は一覧表示のみ、作成/編集/削除は未実装）
- [ ] 前回面談メモの読み取り専用表示
- [ ] キーボードショートカット（Ctrl+S で保存）
- [ ] ローカルストレージからの復旧UI

## 9. 次のフェーズ

### Phase 6: 旧UIページ廃止 + ルーティング整理
- `/interviews/new` → 候補者詳細ページの面談履歴タブにリダイレクト
- `/interviews/[id]` → 候補者詳細ページの面談履歴タブにリダイレクト
- 不要コンポーネントの削除
