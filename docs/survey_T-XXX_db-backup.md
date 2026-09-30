# T-XXX データベースのバックアップ現状調査（BCP 第1段）

調査日: 2026-09-30（JST）／ 調査のみ・コード・DB・Railway 設定の変更なし  
取得方法: Railway GraphQL API（読み取りクエリのみ）、`railway ssh` で Postgres コンテナに入って psql（`default_transaction_read_only=on`）、リポジトリ検索、Railway 公式ドキュメント

---

## 結論（3行）

1. **本番DBを確実に戻せる時点は無い（0日）。** 自動バックアップのスケジュールは未設定。残っている唯一のバックアップは Railway がセキュリティパッチ前に自動で取った 2026-08-16 の1件で、その保持期限は 2026-09-15 に切れている（API の一覧には残っているが、復元できるかは確認していない）。
2. **Railway の外にコピーは無い。** リポジトリ・GitHub Actions・Railway の他サービスのどこにも pg_dump 等のダンプ処理は無い。
3. **いちばん大きな穴:** 本番DB（求職者・面談・エントリー・勤怠・社員の給与/口座など、DBにしか無いデータ）が1本のボリュームにしか存在しない。ボリュームの消失・誤操作・Railway の長期障害のどれが起きても、すべて失われる。

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
| 兄弟リポジトリ（`C:\bizstudio` 配下）の `pg_dump` | ヒット無し |

→ **Railway の外にコピーは無い。**

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
| `pg_dump -Fc`（圧縮）の出力サイズ | 約 60〜120MB／回 | 中身の大半がテキスト（抽出テキスト・チャット・ログ）で3〜5倍に縮む想定 |
| 所要時間 | 1〜3分／回（proxy 経由） | 380MB を 5〜10MB/s で読む計算。I/O 飽和（L-1）の時間帯は避ける |
| 保存容量（毎日30世代） | 約 2〜3.6GB | 120MB × 30 |
| 保存容量（毎日30世代 + 月末12世代） | 約 3.5〜5GB | |
| 復元（外から戻す）時間 | 5〜15分程度（新しい Postgres に `pg_restore`） | インデックス再作成を含む |

※ 実ダンプは禁止事項のため取っていない。数値はサイズからの見立て。  
※ 置き場所には個人情報（求職者・社員の給与/口座）が含まれる。暗号化と権限の設計が前提になる。

---

## 次段階への申し送り（判断材料。今回は何も変更していない）

1. **すぐできる最小対策:** surprising-acceptance / Postgres に Railway の Daily + Weekly バックアップを有効化する（誤操作に対しては6〜27日前まで戻せるようになる。ただしボリュームと一緒に消えるので、Railway 障害には効かない）。
2. **本命:** Railway の外への日次ダンプ（暗号化して別クラウドに保存）。
3. **同じく危ないもの:** kyuujin-pdf-tool の SQLite（一度もバックアップされていない）、bizstudio-finance の Postgres。
