# 06. その他のリポジトリ仕様

## candidate-intake

面談ログ・PDFからの AI 解析エンジン。TypeScript / Gemini API / Glitch。

### 変更禁止ファイル
- `specs/`配下
- `scripts/gas/`配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`

### 重要な仕様
- portal の `src/constants/candidate-flags.ts` と AI解析の選択肢が連動
- PDF Vision フォールバック実装（閾値200文字未満で起動）

## ai-resume-generator

履歴書・職務経歴書の自動生成。TypeScript / Gemini / LibreOffice。

## bizstudio-website

コーポレートサイト。Astro / Vercel / bizstudio.co.jp。

## bizstudio-finance

経理・会計システム。Railway。Phase 1-2 完了。

## scout-scheduler

日程調整アプリ。Vercel / schedule.bizstudio.co.jp。

## offerbox-scout-generator

OfferBox スカウト文章生成。Railway。master 直 push。
