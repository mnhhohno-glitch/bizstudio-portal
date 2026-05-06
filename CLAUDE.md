# bizstudio-portal CLAUDE.md

CA管理画面のメインリポジトリ。Cursor/Claude Code で作業する際、まずこのファイルを参照してください。

## このリポジトリで何をするのか

**bizstudio-portal**: 株式会社ビズスタジオの CA（キャリアアドバイザー）が使う管理画面。
- 求職者管理、面談管理、ブックマーク（求人PDF）管理、エントリー管理、勤怠管理、AIアドバイザー

スタック: Next.js / TypeScript / Tailwind / Prisma / PostgreSQL / Railway

## 関連リポジトリ

| リポジトリ | 役割 | 連携方法 |
|--|--|--|
| **kyuujin-pdf-tool** | 求人マイページのバックエンド | x-api-secret ヘッダ経由のREST API |
| **bizstudio-mypage** | 求職者向けマイページのフロント | kyuujinPDF 経由でデータ参照 |
| **candidate-intake** | 面談ログ・PDF の AI 解析エンジン | API経由で portal が呼出 |
| **ai-resume-generator** | 履歴書・職務経歴書の自動生成 | portal データを参照 |

## 重要な原則

### 1. データソースの認識
- 求職者の基本情報 → portal が source of truth
- 求人マスター → kyuujinPDF が source of truth
- マイページ回答 → kyuujinPDF が source of truth、portal はミラー

### 2. 変更禁止ファイル
- `src/constants/candidate-flags.ts`
- `specs/`、`scripts/gas/`、`loadSpec.ts`、`geminiClient.ts`

### 3. デプロイ判断
- staging 必須: 既存ロジック変更、DB書き換え、AI プロンプト変更
- master 直 push 可: 純粋追加機能、文言修正、nullable カラム追加

## ディレクトリ構造（主要部）

```
src/
├── app/api/                       # APIルート
├── components/
│   ├── candidates/
│   │   ├── HistoryTab.tsx         # 紹介履歴タブ（最頻出修正）
│   │   ├── InterviewForm.tsx      # 面談入力フォーム（頻出修正）
│   │   └── CandidateDetailPage.tsx
│   └── entries/EntryBoard.tsx
├── lib/
│   ├── support-sub-status.ts     # supportSubStatus 自動再計算
│   └── normalize-filename.ts     # ファイル名正規化
└── constants/
    └── candidate-flags.ts        # ★変更禁止★
```

## 詳細仕様の参照先

- `01-architecture.md` — 全リポジトリのアーキテクチャマップ
- `02-data-sources.md` — データソース source of truth 一覧
- `03-portal-spec.md` — このリポジトリの詳細仕様（Memo モデル等）
- `04-kyuujinpdf-spec.md` — kyuujinPDF の仕様
- `05-mypage-spec.md` — bizstudio-mypage の仕様
- `06-other-repos.md` — その他リポジトリ
- `07-deploy-rules.md` — デプロイルール
- `08-bug-patterns.md` — 過去のバグパターン辞書
- `09-scripts-and-tools.md` — 既存スクリプト一覧
- `10-test-users.md` — 動作確認用テストユーザー
- `11-cursor-prompt-templates.md` — Cursor 指示テンプレート
- `12-pitfalls.md` — 罠ポイント（JST タイムゾーン等）
- `13-data-source-paths.md` — 媒体別データソース経路
- `14-ui-component-map.md` — UI コンポーネント構造マップ
