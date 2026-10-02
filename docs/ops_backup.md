# 本番DB・Railway 設定の外部バックアップと復元手順（T-XXX step3）

作成: 2026-10-02（JST）  
対象: bizstudio-portal の本番 PostgreSQL（Railway `surprising-acceptance` / `Postgres`）と、Railway 全プロジェクトの環境変数

> この文書は **Railway が使えない状況でも読めるように** 書いてある。復元手順は Railway に依存しない。

---

## 1. 仕組みの概要

| 項目 | 内容 |
|--|--|
| 実行場所 | GitHub Actions（リポジトリ `mnhhohno-glitch/bizstudio-portal`、master ブランチ） |
| 毎晩のバックアップ | `.github/workflows/db-backup.yml`。毎日 **03:07 JST**（cron `7 18 * * *` UTC） |
| 週1回の復元テスト | `.github/workflows/db-restore-test.yml`。毎週 **日曜 05:07 JST**（cron `7 20 * * 6` UTC） |
| 置き場 | 会社の Google ドライブ（下記 2.） |
| 暗号化 | gpg 対称暗号 **AES-256**（パスフレーズ = GitHub Secrets `BACKUP_PASSPHRASE`） |
| 保持 | 直近 **35日分** + **毎月1日分を12か月分**。それより古いものは、このワークフローが作ったファイルに限って自動削除 |
| 通知 | LINE WORKS（死活監視 T-160 と同じ Bot → 大野将幸への DM）。バックアップは失敗時のみ、復元テストは成功・失敗とも |

毎晩置かれるファイルは 3 つ（日時は JST）:

| ファイル名 | 中身 | 暗号化 |
|--|--|--|
| `portal-db_2026-10-02_0307.dump.gpg` | 本番DBの `pg_dump` カスタム形式（`-Fc`、PostgreSQL 17 の pg_dump で取得） | あり |
| `railway-vars_2026-10-02_0307.json.gpg` | Railway 全プロジェクト・全環境・全サービスの環境変数 JSON | あり |
| `portal-db_2026-10-02_0307.counts.json` | テーブルごとの件数表（件数だけ。個人情報なし） | なし |

件数表はダンプと**同じスナップショット**（`pg_export_snapshot` → `pg_dump --snapshot`）で取っているので、復元後に件数を突き合わせれば「全部戻った」ことを確認できる。

### 処理の流れ（db-backup.yml）

1. `postgres:17` コンテナで `pg_dump`（読み取りのみ）+ 件数表
2. Railway GraphQL API で全変数を JSON に（専用トークン `github-backup`、読み取りのみ）
3. gpg で AES-256 暗号化 → 平文を即削除 → 復号できることを自分で確認
4. Google ドライブの専用フォルダへアップロード（portal と同じサービスアカウント）
5. 世代整理（35日 + 毎月1日×12か月）
6. 失敗したら LINE WORKS へ通知。最後に作業ファイルを shred

### 処理の流れ（db-restore-test.yml）

1. 専用フォルダから最新の一式（3ファイル）を取得。**Drive 作成から 36 時間より古ければ失敗**（夜間バックアップが黙って止まった状態を拾う）
2. 変数 JSON を復号し、JSON として読めることを確認（件数だけ表示）
3. DB ダンプを復号し、Actions 内に立てた使い捨ての `postgres:17`（localhost）に `pg_restore`
4. 件数表と突き合わせ。1 テーブルでもずれたら失敗
5. 成功・失敗とも LINE WORKS へ通知。コンテナと平文を削除

**安全装置**: `.github/scripts/pg-restore-test.sh` は冒頭で復元先ホストを確認し、`localhost` / `127.0.0.1` 以外（特に `rlwy.net` / `railway.app` / `railway.internal` を含む接続先）なら何もせず終了する。復元テストのワークフローには本番の接続文字列を渡していない。

---

## 2. Google ドライブの置き場所

| 項目 | 値 |
|--|--|
| 共有ドライブ | **求人票格納フォルダ**（ID `0AL5KKHA5d7s3Uk9PVA`） |
| フォルダ | **システムバックアップ（自動・暗号化）** |
| フォルダ URL | https://drive.google.com/drive/folders/1uLvpQcGGYYUktHuyTP4fhNGPd575DcL- |
| フォルダ ID | `1uLvpQcGGYYUktHuyTP4fhNGPd575DcL-`（GitHub Secrets `BACKUP_DRIVE_FOLDER_ID`） |
| 書き込み主体 | サービスアカウント `kyuujin-pdf-uploader@kyuujin-pdf-tool.iam.gserviceaccount.com`（この共有ドライブのコンテンツ管理者） |
| 人のメンバー | `agent@bizstudio.co.jp`（管理者） |

この共有ドライブのメンバーは上記 2 つだけ（CA には共有していない）。ファイルは暗号化されているので、仮に閲覧されても中身は読めない。

---

## 3. 復元手順（Railway に依存しない）

必要なもの: **パスフレーズ**（`BACKUP_PASSPHRASE`。GitHub Secrets のほか、将幸さんがパスワード管理に控えている）、`gpg`、PostgreSQL 17 の `pg_restore`（Docker の `postgres:17` で可）。

### 3-1. コピーを取り出す

1. Google ドライブで上記フォルダを開き、戻したい日付の 3 ファイルをダウンロードする（`agent@bizstudio.co.jp` でログイン）。
2. 普段は最新の日付。誤操作で消したデータを戻すなら、消す前の日付を選ぶ。

### 3-2. 復号する

```bash
# DB ダンプ
gpg --batch --pinentry-mode loopback --decrypt \
  --output portal-db.dump portal-db_2026-10-02_0307.dump.gpg
# 環境変数
gpg --batch --pinentry-mode loopback --decrypt \
  --output railway-vars.json railway-vars_2026-10-02_0307.json.gpg
```

パスフレーズを聞かれるので入力する。復号した平文には個人情報が入っている。**作業が終わったら必ず削除する**。

### 3-3. 新しい DB に pg_restore する

どこの PostgreSQL 17 でもよい（Railway の新サービス、Supabase、Neon、自前サーバー、手元の Docker）。

```bash
# 例: 手元で確認する場合（Docker）
docker run -d --name pg17 -e POSTGRES_PASSWORD=xxx -p 5432:5432 postgres:17
docker exec pg17 psql -U postgres -c 'CREATE DATABASE railway;'
docker cp portal-db.dump pg17:/tmp/portal-db.dump
docker exec pg17 pg_restore --dbname="postgresql://postgres:xxx@127.0.0.1:5432/railway" \
  --no-owner --no-privileges --exit-on-error --jobs=2 /tmp/portal-db.dump

# 例: 外部の PostgreSQL 17 へ直接戻す場合
pg_restore --dbname="<新しいDBの接続文字列>" --no-owner --no-privileges --exit-on-error --jobs=2 portal-db.dump
```

- 本番 DB は拡張が `plpgsql` のみ、スキーマは `public` のみ、所有者は `postgres` のみ。特別な前準備は要らない。
- 所要時間の目安: 復元テストの実測で **約 20 秒**（93MB のダンプ・145 テーブル・約 60 万行）。
- 件数の確認: `counts.json` の `tables` と、復元先で `SELECT count(*)` した値を突き合わせる。復元テストと同じクエリは `.github/scripts/pg-restore-test.sh` にある。

### 3-4. 環境変数を新しい環境に入れ直す

`railway-vars.json` の構造:

```
projects[] { name, environments[] { name, shared{}, services[] { name, variables{} } } }
```

- portal 本番は `projects[name="bizstudio-portal"].environments[name="production"].services[name="bizstudio-portal"].variables`。
- `RAILWAY_*` で始まる変数は Railway が自動付与するものなので、新しい環境では**入れない**。
- `DATABASE_URL` は 3-3 で作った新しい DB の接続文字列に差し替える。
- それ以外（LINE WORKS、Google サービスアカウント、Anthropic、Supabase、Resend、kyuujinPDF の `x-api-secret` 等）はそのまま入れる。
- 他プロジェクト（kyuujin-pdf-tool = `PDF Analysis Tool`、finance、candidate-intake 等）も同じ JSON に入っている。

### 3-5. 復元後にやること

- アプリをデプロイして `/api/health` が 200 を返すことを確認。
- 復元時点以降に行われた書き込み（エントリー・面談・打刻など）は失われている。関係者に周知する。
- 作業で復号した平文（`portal-db.dump`・`railway-vars.json`）を削除する。

---

## 4. 通知の見方

| 通知 | いつ | 意味 |
|--|--|--|
| 【バックアップ失敗】portal 本番DB・Railway 変数の夜間退避 | 夜間バックアップが失敗したとき | 今夜のコピーが置けていない。ログを見る（通知内の URL） |
| 【復元テスト成功】portal 本番DBのコピーは戻せます | 毎週日曜 05:07 JST ごろ | 最新コピーが戻せて件数も一致した。**この通知が日曜に来ないこと自体が異常** |
| 【復元テスト失敗】portal 本番DBのコピーを確認してください | 復元テストが失敗したとき | 最新コピーが 36 時間より古い／復号できない／件数不一致のどれか。本文に理由 |

- バックアップは成功しても通知しない（毎晩鳴ると邪魔なため）。成功の確認は Google ドライブのフォルダか、GitHub → Actions → "T-XXX DB backup" の実行履歴で行う。
- GitHub の schedule は遅延・欠落することがある（この repo の 5 分おき死活監視が実際には 1 日 4〜6 回しか走っていない。08-bug-patterns L-2）。1 日欠けても、復元テストの 36 時間チェックで翌日曜までには分かる。

---

## 5. 秘密情報の場所

| 名前（GitHub Secrets） | 中身 |
|--|--|
| `BACKUP_PASSPHRASE` | 暗号化パスフレーズ（48文字のランダム文字列） |
| `PROD_DATABASE_PUBLIC_URL` | 本番 DB の外部接続文字列（pg_dump 用。復元テストには渡していない） |
| `RAILWAY_BACKUP_TOKEN` | Railway ワークスペースの API トークン `github-backup`（変数の読み取り専用用途） |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | portal と同じサービスアカウントの JSON 鍵 |
| `BACKUP_DRIVE_FOLDER_ID` | 専用フォルダの ID |
| `LINEWORKS_*` | 死活監視と共用（T-160） |

### ⚠ パスフレーズを無くすと、コピーは開けない

AES-256 の対称暗号なので、`BACKUP_PASSPHRASE` が無ければ Google ドライブのコピーは**誰にも復号できない**（Google にも GitHub にも Anthropic にも鍵は無い）。GitHub Secrets は値を読み出せないため、GitHub のアカウントを失うと Secrets からも取り出せない。必ずパスワード管理ツールと紙の両方に控えておくこと。

パスフレーズを変える場合: GitHub Secrets の `BACKUP_PASSPHRASE` を更新すると、翌日以降のコピーは新しいパスフレーズで暗号化される。**古いコピーは古いパスフレーズでしか開けない**ので、古い方も保管する。

---

## 6. 手動で動かす

```bash
gh workflow run db-backup.yml --ref master          # 今すぐバックアップ
gh workflow run db-restore-test.yml --ref master     # 今すぐ復元テスト
gh run list --workflow=db-backup.yml --limit 5       # 実行履歴
```

GitHub の画面なら Actions → 該当ワークフロー → "Run workflow"。

---

## 7. 関連

- 調査と Railway 内バックアップの設定: `docs/survey_T-XXX_db-backup.md`（step1・step2・step3 対処記録）
- Railway 標準バックアップはボリュームと一緒に消える: `.claude/12-pitfalls.md` 罠 #59
- Railway 全体障害時の見分け方: `.claude/08-bug-patterns.md` L-2
