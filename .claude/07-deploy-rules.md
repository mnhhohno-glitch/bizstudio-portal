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

### 本番デプロイ衝突回避（portal-1/portal-2 並行運用）

portal は複数 worktree から同じ master・同じ Railway 本番サービスにつながる。master への push が二重に走ると本番デプロイが衝突するため、master push 系の手順では `git push origin master` の直前に必ず待機スクリプトを挟む:

```
# Windows
py scripts\wait_railway_idle.py ; if ($?) { git push origin master }

# Unix
python3 scripts/wait_railway_idle.py && git push origin master
```

このスクリプトは本番サービス `bizstudio-portal`（master）のデプロイが idle になるまでブロッキング待機する。staging（検証）への push は衝突無害のため対象外。詳細仕様は `scripts/wait_railway_idle.py` の docstring 参照。

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
