# 07. デプロイルール

## bizstudio-portal

### staging 必須

- 既存ロジック・既存APIの変更
- 既存DBレコード書き換え（マイグレーション含む）
- AI解析プロンプトの変更
- 認証・権限まわりの変更

### master 直 push 可

- 純粋な追加機能（新API、新UI、新カラムでnullable）
- 文言修正
- マスタへのレコード追加（既存データに影響なし）
- オプトインのプロパティ追加

## kyuujin-pdf-tool

- production: master 自動デプロイ
- staging: staging ブランチ

## その他

- bizstudio-mypage: main 直 push、Vercel 自動デプロイ
- ai-resume-generator: main 直 push
- offerbox-scout-generator: master 直 push、Railway 自動デプロイ

## 重要な原則

- 1 PR / 1 コミット = 1 機能
- 万一の事故時、git revert で5分以内に戻せる粒度を保つ
