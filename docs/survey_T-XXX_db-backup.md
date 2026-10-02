# T-XXX データベースのバックアップ現状調査（BCP 第1段）

調査日: 2026-09-30（JST）／ 調査のみ・コード・DB・Railway 設定の変更なし  
取得方法: Railway GraphQL API（読み取りクエリのみ）、`railway ssh` で Postgres コンテナに入って psql（`default_transaction_read_only=on`）、リポジトリ検索、Railway 公式ドキュメント

---

## 結論（3行）

1. **Railway 上で確実に戻せる時点は無い。Railway の外まで含めても、戻せるのは 114日前（2026-06-08）まで。** 自動バックアップのスケジュールは未設定。Railway に残る唯一のバックアップ（2026-08-16。パッチ適用前に Railway が作成）は 2026-09-15 に保持期限が切れている（API の一覧には残っているが、復元できるかは確認していない）。
2. **Railway の外には、開発機に手動ダンプが1本あるだけ**（`C:\bizstudio\backups\railway_prod_20260608_120043.dump`、2026-06-08 12:00、25MB）。定期的なダンプの仕組みは、リポジトリ・GitHub Actions・Railway のどこにも無い。
3. **いちばん大きな穴:** 本番DB（求職者・面談・エントリー・勤怠・社員の給与/口座など、DBにしか無いデータ）の最新状態が、1本のボリュームにしか存在しない。ボリュームの消失・誤操作・Railway の長期障害のどれが起きても、06-08 以降の約4か月分が失われる。

---

## 1. 本番DBの Railway 標準バックアップ

### 対象

| 項目 | 値 |
|--|--|
| プロジェクト / 環境 / サービス | `surprising-acceptance` / production / `Postgres` |
| イメージ | `ghcr.io/railwayapp-templates/postgres-ssl:17`（PostgreSQL 17.11） |
| ボリューム | `postgres-volume`（mount `/var/lib/postgresql/data`、状態 READY） |
| ボリュームサイズ | 使用 約1,747MB（API の currentSizeMB）／ 上限 50,000MB |
| 最終デプロイ | 2026-08-16 09:17 UTC（セキュリティパッチ適用時） |

### バックアップ設定と一覧

| 項目 | 結果 |
|--|--|
| 自動スケジュール（毎日／毎週／毎月） | **すべて無し**（`volumeInstanceBackupScheduleList` = 空） |
| 保存されているバックアップ | 1件のみ |
| └ 名前 | `Pre-Security-Patch Backup`（Railway がパッチ適用前に作成。スケジュール由来ではない） |
| └ 作成日時 | 2026-08-16 09:17 UTC（18:17 JST） |
| └ 保持期限 | **2026-09-15 09:17 UTC（期限切れ）** |
| └ サイズ | 差分 489MB ／ 参照 1,586MB |
| PITR（任意時点への復元） | **使えない**。`archive_mode = off`。Railway API の PITR は HA クラスタ（Patroni）専用で、このテンプレートの単体 Postgres は対象外 |
| ワークスペースのプラン | **PRO**（ACTIVE）。バックアップ機能はプラン上使える |

> 期限切れのバックアップは API 一覧に残っているが、復元を試すと本番ボリュームが差し替わるため試していない。**戻せる時点としては数えない。**  
> 画面で確認する場所: Railway → surprising-acceptance → Postgres → Backups タブ。

---

## 2. Railway の外にあるバックアップの有無

| 確認先 | 結果 |
|--|--|
| リポジトリ内 `pg_dump` / `pg_basebackup` | 無し |
| リポジトリ内 `backup` / `バックアップ` | DB のダンプ処理は無い（見つかったのは作業前の CSV 退避やドキュメントの記述だけ） |
| `.github/workflows/` の定期実行（8本） | auto-expire / resubmit-stale / secure-transfer-cleanup / due-reminder / onedrive-retry / recommend-analyze / recommend-expire / uptime-monitor。**どれも本番 API を叩くだけで、DB のダンプは無い** |
| Railway 全9プロジェクトのサービス | `cronSchedule` が設定されたサービスは0件。ダンプ用のサービスも無い |
| 兄弟リポジトリ（ai-resume-generator / finance / mypage / candidate-intake / kyuujin-pdf-tool / offerbox / scout-scheduler / mensetsu）の `pg_dump` | ヒット無し |
| 開発機 `C:\bizstudio\backups\` | **`railway_prod_20260608_120043.dump` が1本**（25,412,751 バイト）。確認したのはヘッダだけ: pg_dump custom 形式、DB 名 `railway`、ダンプ元 PostgreSQL 17.7（当時の本番の版と一致）。中身は開いていない |

→ **Railway の外のコピーは、2026-06-08 に手動で取った1本だけ。** 定期的な仕組みは無い。個人情報を含むファイルが、暗号化されないまま開発機に置かれている点にも注意。

---

## 3. データの量と中身（読み取りのみ）

### サイズ

| 項目 | 値 |
|--|--|
| `pg_database_size('railway')` | **380 MB** |
| テーブル数 / 推定行数 | 139 テーブル / 約43万行（`n_live_tup`） |
| WAL | 80 MB |
| `df -h /var/lib/postgresql/data` | 46G 中 540M 使用（2%） |

### テーブル上位30（インデックス込みのサイズ順）

| # | テーブル | 行数(推定) | サイズ |
|--|--|--:|--:|
| 1 | candidate_files | 15,779 | 111 MB |
| 2 | scout_delivery_slots | 70,445 | 30 MB |
| 3 | ai_usage_logs | 40,004 | 23 MB |
| 4 | postal_code_masters | 0 ※ | 23 MB |
| 5 | scout_send_records | 105,052 | 22 MB |
| 6 | candidate_activity_logs | 42,634 | 21 MB |
| 7 | advisor_chat_messages | 7,335 | 21 MB |
| 8 | job_entries | 29,008 | 18 MB |
| 9 | rpa_execution_batches | 28,653 | 13 MB |
| 10 | interview_details | 3,064 | 12 MB |
| 11 | interview_records | 5,720 | 7.7 MB |
| 12 | advisor_chat_sessions | 940 | 5.8 MB |
| 13 | branch_masters | 0 ※ | 5.1 MB |
| 14 | candidates | 4,604 | 4.3 MB |
| 15 | job_eval_parts | 951 | 4.2 MB |
| 16 | audit_logs | 7,090 | 3.1 MB |
| 17 | punch_events | 10,452 | 2.8 MB |
| 18 | onedrive_sync_logs | 4,588 | 2.6 MB |
| 19 | task_field_values | 6,934 | 2.5 MB |
| 20 | tasks | 3,568 | 2.4 MB |
| 21 | job_eval_records | 861 | 2.3 MB |
| 22 | ScheduleEntry | 4,906 | 1.7 MB |
| 23 | task_assignees | 6,115 | 1.6 MB |
| 24 | daily_report_chats | 646 | 1.5 MB |
| 25 | work_histories | 1,418 | 1.3 MB |
| 26 | onedrive_folder_url_ledger | 1,826 | 1.3 MB |
| 27 | advisor_usage_logs | 4,276 | 1.3 MB |
| 28 | daily_attendances | 3,574 | 1.3 MB |
| 29 | interview_memos | 873 | 1.2 MB |
| 30 | daily_reports | 376 | 1.1 MB |

※ `n_live_tup` は統計情報の推定値。2026-08-16 の再起動後に統計が更新されていないマスタは 0 と出る（サイズから見ると実データはある）。

### データの2分類（`prisma/schema.prisma` 138モデルとコードから判断）

**A. DBにしか無いデータ（失うと復元できない）**

| 領域 | 主なモデル |
|--|--|
| 求職者の基本情報（portal が source of truth） | Candidate, CandidateNote, CandidateMemo, ContactLog, CandidateSettingsHistory, WorkHistory, CandidateActivityLog |
| 面談 | InterviewRecord, InterviewDetail, InterviewRating, InterviewMemo, InterviewScriptAnswer, FormDraft, InterviewSupportSession |
| エントリー・選考 | JobEntry, HiddenJobIntroduction, CandidateJobApplication, JobEvalRecord / JobEvalPart |
| 社員・勤怠・給与（個人情報の中でも機微） | Employee, EmployeeBankAccount, EmployeeSalary, EmployeeInsurance, EmployeeDependent, DailyAttendance, PunchEvent, LeaveRequest, ModificationRequest |
| 業務運用 | Task 系、ScheduleEntry / DailySchedule / DailyReport 系、Announcement |
| スカウト運用 | ScoutDeliverySlot, ScoutSendRecord, ScoutCondition, ScoutRun, ScoutTemplate, RpaScout 系, MynaviScoutHistory |
| AI 関連の履歴 | AdvisorChatSession / Message, InterviewPrepRoom / Message, AdvisorTypeDiagnosis |
| 認証・監査・設定 | User, AppSession, AuditLog, SystemSetting, 研修（Training 系の回答） |

**B. 原本が別の場所にあり、DBは控え・メタ情報だけのデータ**

| データ | 原本の場所 | DB にあるもの |
|--|--|--|
| 求職者ファイル（CandidateFile） | Google Drive（`driveFileId`） | メタ情報 + 抽出テキスト（`extractedText` / `parsedText`。再抽出できる） |
| お知らせ添付・マニュアル | Google Drive（`driveFileId`） | メタ情報 |
| タスク添付・面談添付・セキュア送信ファイル | Supabase Storage（`storagePath`） | メタ情報 |
| 求職者 OneDrive フォルダ | OneDrive | URL（`oneDriveFolderUrl`）と同期ログ |
| マイページ回答・保存求人（CandidateJobResponse / CandidateSavedJob） | kyuujinPDF | ミラー |
| 面談ログ本文 | Google Drive（MEETING フォルダの .txt） | 解析結果・要約 |
| マスタ（郵便番号・銀行・支店・カテゴリ・祝日） | 公開データ／初期投入スクリプト | 全件（入れ直せる） |
| AI 利用ログ（AiUsageLog / AdvisorUsageLog） | Anthropic / Google の請求 | 集計用の記録（無くなると費用の内訳は消えるが、業務は止まらない） |

> 注意: B の Drive / Supabase の実体は残っていても、**どの求職者のファイルかという紐付けは DB にしか無い**。DB を失うと、実体が残っていても探し出すのが実質難しくなる。

---

## 4. 他の Railway データ一覧（参考・読み取りのみ）

ワークスペースは1つ（PRO）、プロジェクトは9つ。ボリュームを持つサービスをすべて挙げる。

| プロジェクト | サービス | 種別 | ボリューム使用 / 上限 | スケジュール | 最新バックアップ（期限） |
|--|--|--|--|--|--|
| **surprising-acceptance** | Postgres（**portal 本番**） | PG17 | 1,747 / 50,000MB | **無し** | 2026-08-16（**09-15 期限切れ**） |
| **PDF Analysis Tool**（= kyuujin-pdf-tool） | web（SQLite, `/data`） | SQLite | 1,081 / 5,000MB | **無し** | **一度も無い** |
| PDF Analysis Tool | PostgreSQL-staging | PG17 | 1,106 / 50,000MB | 無し | 2026-08-30（09-29 期限切れ） |
| **bizstudio-finance** | Postgres | PG18 | 1,149 / 50,000MB | **無し** | 2026-08-29（09-28 期限切れ） |
| ai-resume-generator | Postgres | PG17 | 1,130 / 50,000MB | 無し | 2026-08-29（09-28 期限切れ） |
| candidate-intake | candidate-intake（`/data`） | アプリ用 | 1,064 / 50,000MB | 無し | 一度も無い |
| candidate-intake | candidate-intake-staging（`/data`） | アプリ用 | 1,058 / 50,000MB | 無し | 一度も無い |
| offerbox-scout-generator | Postgres | PG17 | 1,193 / 50,000MB | 無し | 2026-08-29（09-28 期限切れ） |
| offerbox-scout-generator | Postgres-qNB4 | PG18 | 1,126 / 50,000MB | 無し | 2026-08-29（09-28 期限切れ） |
| mensetutaisaku-application | Postgres（production 環境） | PG17 | 345 / 5,000MB | 無し | 2026-08-29（09-28 期限切れ） |
| mensetutaisaku-application | Postgres（staging 環境） | PG17 | 1,393 / 50,000MB | 無し | 2026-08-29（09-28 期限切れ） |

- ボリュームがないプロジェクト: `bizstudio-portal`（アプリのみ）、`bizstudio-job-platform`（Supabase を使うため対象外）
- **バックアップのスケジュールがあるボリュームは全11本中0本。** 残っているバックアップは、2026-08 のセキュリティパッチで Railway が自動作成した1回分だけで、それもすべて期限切れ。
- kyuujin-pdf-tool の SQLite（求人マスター・マイページ回答の source of truth）は、**バックアップが一度も取られていない**。

---

## 5. 復元の手順と時間の見立て（書くだけ・実行していない）

### Railway 標準バックアップから戻す場合（公式ドキュメント https://docs.railway.com/reference/backups の要約）

1. Postgres サービス → Backups タブで、戻したいバックアップの「Restore」を選ぶ。
2. **上書きはされない。** バックアップの日付を名前にした新しいボリュームが作られ、同じマウント先（`/var/lib/postgresql/data`）に付け替わる。元のボリュームは外れた状態でプロジェクトに残る（後で付け直せる）。
3. 変更を適用するとサービスが再デプロイされる。その間 DB は止まる（portal / staging / ai-resume-generator が接続エラーになる）。
4. 制約:
   - **同じプロジェクトの同じ環境にしか戻せない**（別サービスや別環境には戻せない）。「戻さずに中身だけ覗く」ことはできない。
   - **ボリュームを消去（wipe）すると、バックアップもすべて消える。** つまり標準バックアップはボリュームと運命を共にする。Railway の外への退避ではない。
   - スケジュールごとの保持期間: 毎日＝6日、毎週＝27日、毎月＝89日。手動バックアップはボリューム上限の50%まで。
   - 課金は差分（Copy-on-Write）の容量分だけ。
5. 復元後にバックアップ時点以降の書き込み（エントリー・面談・打刻など）は消える。一部だけ取り出して戻すには、元ボリュームを別サービスに付けて SQL で拾う必要がある（手順は別途検討）。

### Railway の外へ毎日コピーした場合の見立て

| 項目 | 見立て | 根拠 |
|--|--|--|
| ダンプ対象 | 約380MB（インデックスを除くと 250〜300MB 程度） | `pg_database_size` |
| `pg_dump -Fc`（圧縮）の出力サイズ | 約 40〜100MB／回 | 2026-06-08 の実ダンプが 25MB。その後の増加分（スカウト記録・抽出テキスト・チャット等）を見込む |
| 所要時間 | 1〜3分／回（proxy 経由） | 380MB を 5〜10MB/s で読む計算。I/O 飽和（L-1）の時間帯は避ける |
| 保存容量（毎日30世代） | 約 1.2〜3GB | 40〜100MB × 30 |
| 保存容量（毎日30世代 + 月末12世代） | 約 1.7〜4.2GB | |
| 復元（外から戻す）時間 | 5〜15分程度（新しい Postgres に `pg_restore`） | インデックス再作成を含む |

※ 今回は新しいダンプを取っていない（禁止事項）。数値は DB サイズと 06-08 のダンプからの見立て。  
※ 置き場所には個人情報（求職者・社員の給与/口座）が含まれる。暗号化と権限の設計が前提になる。

---

## 次段階への申し送り（判断材料。今回は何も変更していない）

1. **すぐできる最小対策:** surprising-acceptance / Postgres に Railway の Daily + Weekly バックアップを有効化する（誤操作に対しては6〜27日前まで戻せるようになる。ただしボリュームと一緒に消えるので、Railway 障害には効かない）。
2. **本命:** Railway の外への日次ダンプ（暗号化して別クラウドに保存）。
3. 開発機の `C:\bizstudio\backups\railway_prod_20260608_120043.dump`（暗号化なし・個人情報あり）の扱いを決める（本命の仕組みができたら安全な場所へ移すか削除する）。
4. **同じく危ないもの:** kyuujin-pdf-tool の SQLite（一度もバックアップされていない）、bizstudio-finance の Postgres。

---

## step2 対処記録（2026-09-30）

実施: 2026-09-30 18:33 JST（09:33 UTC）／ Railway GraphQL API（`volumeInstanceBackupCreate`・`volumeInstanceBackupScheduleUpdate`。名前は introspection で確認）  
行った操作は「手動バックアップの作成」と「スケジュール設定」だけ。復元・wipe・バックアップ削除・再起動・再デプロイ・環境変数変更・DB 接続はしていない。期限切れの古いバックアップもそのまま残している。

### 対象ボリュームの確定

`projects(workspaceId)` → `volumes` → `volumeInstances` で列挙した結果は **11本で、項目4の表と一致**（差分なし）。

### 結果（11本）

手動バックアップ名はすべて `T-XXX step2 manual 2026-09-30`。スケジュールの cron は API の値そのまま（UTC）。

| # | プロジェクト | 環境 | サービス | 手動バックアップ作成日時（UTC） | 状態 | 毎日 | 毎週 | 毎月 |
|--|--|--|--|--|--|--|--|--|
| 1 | **surprising-acceptance**（portal 本番） | production | Postgres | 2026-09-30 09:33:27 | 完了（参照 1,746MB） | `1 8 * * *` | `33 22 * * 6` | `22 21 1 * *` |
| 2 | offerbox-scout-generator | production | Postgres | 2026-09-30 09:33:28 | 完了（参照 1,193MB） | `47 20 * * *` | `45 20 * * 6` | `51 2 1 * *` |
| 3 | offerbox-scout-generator | production | Postgres-qNB4 | 2026-09-30 09:33:29 | 完了（参照 1,125MB） | `50 8 * * *` | `23 10 * * 6` | `5 2 1 * *` |
| 4 | bizstudio-finance | production | Postgres | 2026-09-30 09:33:30 | 完了（参照 1,149MB） | `48 7 * * *` | `21 9 * * 6` | `55 5 1 * *` |
| 5 | ai-resume-generator | production | Postgres | 2026-09-30 09:33:31 | 完了（参照 1,129MB） | `21 19 * * *` | `58 9 * * 6` | `24 15 1 * *` |
| 6 | mensetutaisaku-application | production | Postgres | 2026-09-30 09:33:32 | 完了（参照 344MB） | `58 5 * * *` | `53 4 * * 6` | `8 0 1 * *` |
| 7 | mensetutaisaku-application | staging | Postgres | 2026-09-30 09:33:34 | 完了（参照 1,392MB） | `34 1 * * *` | `52 7 * * 6` | `33 2 1 * *` |
| 8 | candidate-intake | production | candidate-intake-staging | 2026-09-30 09:33:35 | 完了（参照 1,058MB） | `17 4 * * *` | `32 18 * * 6` | `9 14 1 * *` |
| 9 | candidate-intake | production | candidate-intake | 2026-09-30 09:33:36 | 完了（参照 1,064MB） | `58 14 * * *` | `16 0 * * 6` | `36 19 1 * *` |
| 10 | PDF Analysis Tool（kyuujin-pdf-tool） | production | PostgreSQL-staging | 2026-09-30 09:33:38 | 完了（参照 1,105MB） | `33 15 * * *` | `42 21 * * 6` | `21 21 1 * *` |
| 11 | **PDF Analysis Tool**（kyuujin-pdf-tool） | production | web（SQLite `/data`） | 2026-09-30 09:33:39 | 完了（参照 1,081MB） | `58 7 * * *` | `49 14 * * 6` | `54 10 1 * *` |

- 設定前のスケジュールは11本とも空（既存の種類は無し）。11本とも DAILY / WEEKLY / MONTHLY の3種類を設定し、API で読み直して3種類とも入っていることを確認した。
- 「完了」の判定: API にはバックアップ単位の状態欄が無く、作成時に返る workflowId の状態照会（`workflowStatus`）はこのトークンでは `Not Authorized` になる。そのため、`volumeInstanceBackupList` に今日の手動バックアップが載り、`referencedMB` がボリューム使用量と一致していることをもって完了とした。
- candidate-intake と kyuujin-pdf-tool の SQLite（#8・#9・#11）は、これが初めてのバックアップ。

### 失敗したボリューム

**無し**（11本中11本成功。再試行が必要になったものも無し）。

### 保持期間

| 種類 | 保持期間 | 根拠 |
|--|--|--|
| 毎日 | 6日 | API の `retentionSeconds`（518,400秒）・公式ドキュメント |
| 毎週（土曜） | 27日 | API（2,332,800秒）・公式ドキュメント |
| 毎月（1日） | 89日 | API（7,689,600秒）・公式ドキュメント |
| 手動 | **期限無し**（API の `expiresAt` = null） | 公式ドキュメントに期限の記載は無い。手動バックアップの合計はボリューム容量の50%まで |

→ 今日の手動バックアップは期限切れにならず、スケジュールの初回分が溜まるまでの復元点として残る。

### 追加費用の見立て

- 課金はボリュームと同じ単価（約 $0.15/GB・月）で、**各バックアップ固有の差分（Copy-on-Write）の容量分だけ**（公式ドキュメント）。作成直後の手動バックアップは差分 0MB（本番 DB の `usedMB` = 0）。
- 11本の使用量合計は約 12.4GB。step1 で見た本番 DB の差分は、約1.5か月で 489MB だった。
- 見立て: 保持中のバックアップ（毎日6・毎週4・毎月3・手動1）の差分合計は、全ボリュームで約 5〜20GB → **月 $1〜3 程度**。
- 上限（全バックアップの中身が完全に入れ替わった場合。現実には起きない）: 14世代 × 12.4GB ≒ 174GB → 月 約 $26。

### 限界

Railway 標準バックアップはボリュームと一緒に消える（wipe でバックアップも全消去）ため、この対処では Railway 障害やボリューム消失には備えられない。Railway の外への退避は step3 で行う。

---

## step3 対処記録（2026-10-02）

実施: 2026-10-02 09:45〜10:10 JST。コミット `35827b5`（ワークフロー・スクリプト）＋ docs コミット。  
本番DBへの操作は読み取り（`pg_dump` / 件数 `SELECT`）のみ。Railway の設定（公開設定・ボリューム・バックアップ・再起動・再デプロイ）は変えていない。

### 作ったもの

| ファイル | 役割 |
|--|--|
| `.github/workflows/db-backup.yml` | 毎日 03:07 JST（`7 18 * * *` UTC）。pg_dump → 件数表 → Railway 変数 → gpg AES-256 → Google ドライブ → 世代整理。失敗時 LINE WORKS |
| `.github/workflows/db-restore-test.yml` | 毎週日曜 05:07 JST（`7 20 * * 6` UTC）。最新一式を取得（36時間超で失敗）→ 復号 → 使い捨て postgres:17 に pg_restore → 件数突き合わせ → 変数 JSON 検証。成功・失敗とも LINE WORKS |
| `.github/scripts/pg-dump-with-counts.sh` | postgres:17 コンテナ内で実行。`pg_export_snapshot` → `pg_dump --snapshot` で、ダンプと件数表を同一スナップショットにする |
| `.github/scripts/pg-restore-test.sh` | 冒頭で復元先ホストが localhost 以外なら即中断（exit 90/91）。復元後に件数表と全テーブル突き合わせ |
| `.github/scripts/railway-vars-export.mjs` | Railway GraphQL で全プロジェクト・全環境・全サービスの変数を JSON に |
| `.github/scripts/drive-lib.mjs` / `drive-upload.mjs` / `drive-retention.mjs` / `drive-fetch-latest.mjs` | サービスアカウント JWT で Drive REST を直接呼ぶ（npm install 不要）。暗号化していないファイルのアップロードは拒否。整理は `appProperties` の目印があるファイルだけ |
| `.github/scripts/backup-notify.mjs` | LINE WORKS 通知（`uptime-notify.mjs` と同方式・同宛先。本文を環境変数で渡せる版。`uptime-notify.mjs` は未変更） |
| `docs/ops_backup.md` | 仕組み・置き場・Railway 非依存の復元手順・通知の見方・パスフレーズの扱い |

### 事前調査の結果と選んだ経路

| 項目 | 結果 |
|--|--|
| Google ドライブの認証方式 | portal は **サービスアカウント**（`GOOGLE_SERVICE_ACCOUNT_KEY`、`kyuujin-pdf-uploader@kyuujin-pdf-tool.iam.gserviceaccount.com`）。ドメイン全体の委任は**無し**（`agent@bizstudio.co.jp` の偽装は `unauthorized_client`） |
| 書き込み先 | サービスアカウントがコンテンツ管理者として入っている共有ドライブ「**求人票格納フォルダ**」（メンバーはサービスアカウントと `agent@bizstudio.co.jp` の 2 つだけ）の直下に、専用フォルダ「**システムバックアップ（自動・暗号化）**」を API で作成した。**人の操作は不要だった** |
| GitHub Secrets の設定手段 | `gh` が `mnhhohno-glitch` でログイン済み（scope: repo）。`gh secret set` で設定 |
| GitHub Actions の利用枠 | リポジトリは **public** のため、標準ランナーの分数は**無料・無制限**（billing API は `user` scope が無く読めなかったが、public repo は課金対象外）。今回の追加は 1 日 1 回 約 1.5 分 + 週 1 回 約 1 分で、仮に private でも月 60 分未満 |
| Railway トークン | 専用トークン **`github-backup`** をワークスペース単位で新規発行（`apiTokenCreate`）。既存トークンは流用していない |
| 本番 DB の構成 | 拡張 `plpgsql` のみ、スキーマ `public` のみ、所有者 `postgres` のみ → 素の postgres:17 に戻せる |

### 初回実行の結果

| 項目 | 値 |
|--|--|
| バックアップ run | [36949094008](https://github.com/mnhhohno-glitch/bizstudio-portal/actions/runs/36949094008)・2026-10-02 10:03 JST・**成功**・所要 1 分 23 秒 |
| ダンプ | 93,000,344 bytes（pg_dump 17.11 ↔ サーバー 17.11）。暗号化後 88.7MB |
| 件数表 | 145 テーブル・599,195 行 |
| Railway 変数 | 9 プロジェクト・22 サービス・28 サービス×環境・680 変数（暗号化後 81KB） |
| Drive に置かれたファイル | `portal-db_2026-10-02_1003.dump.gpg` / `portal-db_2026-10-02_1003.counts.json` / `railway-vars_2026-10-02_1003.json.gpg`（API で 3 件確認） |
| 復元テスト run | [36949306970](https://github.com/mnhhohno-glitch/bizstudio-portal/actions/runs/36949306970)・2026-10-02 10:06 JST・**成功**・所要 39 秒 |
| 件数突き合わせ | **145 テーブル・599,195 行すべて一致** |
| 変数 JSON | 復号・JSON 解析 OK（9 / 28 / 680） |
| LINE WORKS | 「【復元テスト成功】portal 本番DBのコピーは戻せます」を送信（HTTP 成功をログで確認） |
| ログの漏えい確認 | 2 run のログに DB パスワード・ホスト名・パスフレーズ・秘密鍵の文字列が無いことを grep で確認（いずれも 0 件） |
| 安全装置の動作確認 | ローカルで復元先に `trolley.proxy.rlwy.net` を渡すと `exit 90` で中断することを確認 |

### 事後処理

- 開発機の `C:\bizstudio\backups\railway_prod_20260608_120043.dump`（暗号化なし・個人情報あり）は、復元テスト成功を確認してから**削除した**。
- パスフレーズは `C:\bizstudio\backups\BACKUP_PASSPHRASE_受け渡し用.txt` にのみ書き出した（リポジトリ外・git 管理外）。将幸さんがパスワード管理と紙に控えたらファイルを削除する。
- 作業中に scratchpad に置いた鍵・接続文字列・トークン・平文ダンプは削除した。

### 残課題（人の操作が必要なもの）

- **無し**。共有ドライブの作成・メンバー追加は不要だった。
- 任意: 死活監視 `uptime-monitor.yml` が実際には 1 日 4〜6 回しか走っていない（08-bug-patterns L-2）。5 分間隔の監視としては機能していないので、外部監視サービスへの乗り換えを別タスクで検討する。
