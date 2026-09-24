# T-191 portal API 認証有無 棚卸し（2026-09-06 / 2026-09-07 対処後に更新）

対象: `src/app/api/**/route.ts` 全 382 件（棚卸し時 383 件 − 削除した `/api/attendance/fix-status` 1 件）。
`src/middleware.ts` は `/api/` を丸ごと素通しにしているため、認証は各 route 内の実装のみが担保。

## 分類サマリ

| 分類 | 棚卸し時 | 対処後 |
|--|--|--|
| session | 261 | 270 |
| secret | 56 | 55 |
| none | 31 | 18 |
| session+secret | 20 | 21 |
| token | 14 | 16 |
| bearer | 1 | 2 |
| （route 削除） | — | 1 |

判定方法: route 本体に加え、`@/lib/**` からの import 先（1階層）まで読んで
`getSessionUser` 系 / 共有鍵（`x-api-secret`, `INTERNAL_API_KEY`, `CANDIDATE_SITE_API_KEY`, RPA 鍵 等）/ `AI_READ_API_KEY` の有無を判定。
URL トークン方式（`[token]`）と OAuth/招待トークン系は手動で `token` に補正。

---

## 1. none かつ個人情報 Y（棚卸し時 12 件）→ 2026-09-07 に全件対処済み（残 0 件）

| パス | メソッド | 棚卸し時 | 対処後 | データ種別 | 個人情報 | 対処内容 |
|--|--|--|--|--|--|--|
| `/api/attendance/fix-status` | GET | none | **削除** | 社員 | Y | GET なのに DailyAttendance を一括 UPDATE する残骸。呼び出し元ゼロを再確認して route ファイルごと削除（git 履歴で復元可） |
| `/api/candidates` | GET,OPTIONS | none | session | 求職者 | Y | `getSessionUser()` 必須。candidate-intake の旧 `/register` 画面（2026-07-07 のアクセス 1 件が最後・登録は 2026-06-16 が最後）は廃止し、導線も削除。CORS ヘッダは残置（credentials 無しの `*` は認証後は無害） |
| `/api/candidates/[candidateId]/jimu-sessions` | GET | none | session | 求職者 | Y | `getSessionUser()` 必須 |
| `/api/candidates/[candidateId]/memos` | GET,POST | none | session | 求職者 | Y | `getSessionUser()` 必須 |
| `/api/candidates/[candidateId]/memos/[memoId]` | PATCH,DELETE | none | session | 求職者 | Y | `getSessionUser()` 必須 |
| `/api/guides/generate-axis` | POST | none | token | 求職者 | Y | ガイド token 必須（`x-guide-token` ヘッダ or body `guideToken`）。CA 画面用に session フォールバックあり。token 無効時は `/api/guides/[token]` と同じ 404「無効なトークンです」 |
| `/api/guides/parse-resume` | POST | none | token | 求職者 | Y | 同上（FormData なのでヘッダ or `guideToken` フィールド） |
| `/api/interviews/[id]/autosave` | PATCH | none | session | 求職者 | Y | `getSessionUser()` 必須。`autosaveToken` は従来どおり競合検知（409）のみに使う |
| `/api/interviews/[id]/memos` | GET,POST | none | session | 求職者 | Y | `getSessionUser()` 必須 |
| `/api/interviews/[id]/memos/[memoId]` | PATCH,DELETE | none | session | 求職者 | Y | `getSessionUser()` 必須 |
| `/api/jimu/create` | POST | none | session | 求職者 | Y | `getSessionUser()` 必須 |
| `/api/master/employees` | GET,POST | none | session | 社員 | Y | GET=session 必須 / POST（社員登録）=admin 限定（`/api/admin/employees` と同じ `actor.role !== "admin"` → 403） |

### 併せて変更した route

| パス | メソッド | 棚卸し時 | 対処後 | 対処内容 |
|--|--|--|--|--|
| `/api/employees` | GET,OPTIONS | secret | session+secret | 既定（パラメータなし）を session 必須化。`?includeInactive=true` は従来どおり `x-api-key`（INTERNAL_API_KEY）のまま |
| `/api/ai/schema-check` | GET | none | bearer | `/api/ai/company-kpi` と同じ `assertAiReadAuth`（Bearer `AI_READ_API_KEY`）。`/api/ai/health` は死活監視用なので none のまま |

### 外部依存の扱い

- **candidate-intake**: 旧 `/register` 画面は 2026-06-16 以降レコード作成ゼロ・2026-07-07 のアクセス 1 件が最後（Railway httpMetrics で確認）。切り捨て確定。
  portal 側の導線（`DocumentsTab.tsx` の「📝 面談登録 ↗」ボタン）も本タスクで削除。
- **ai-resume-generator**: portal の `/api/candidates`（一覧）・`/api/employees` は使わず、portal DB を直接参照 + `/api/candidates/{id}/files*` を
  portal 発行の `ast_` Bearer（AppSession）で叩く。files 系 route の `resolveUserId()` は Cookie session と `Authorization: Bearer ast_...` の両方を受理するため、本変更の影響を受けない。

## 2. none かつ個人情報 N（対処後 18 件）

`/api/ai/schema-check` は bearer 化したため本節から除外（§1 の「併せて変更した route」参照）。

| パス | メソッド | 分類 | データ種別 | 個人情報 | 備考 |
|--|--|--|--|--|--|
| `/api/ai/health` | GET | none | 設定 | N | 意図的（死活監視）。DB/PIIは返さない |
| `/api/area-categories` | GET | none | 求人/マスタ | N |  |
| `/api/area-categories/[majorId]/middles` | GET | none | 求人/マスタ | N |  |
| `/api/area-categories/all` | GET | none | 求人/マスタ | N |  |
| `/api/area-categories/middles/[middleId]/minors` | GET | none | 求人/マスタ | N |  |
| `/api/health` | GET | none | その他 | N | 意図的（死活監視） |
| `/api/industry-categories` | GET | none | 求人/マスタ | N |  |
| `/api/industry-categories/[majorId]/middles` | GET | none | 求人/マスタ | N |  |
| `/api/industry-categories/all` | GET | none | 求人/マスタ | N |  |
| `/api/industry-categories/middles/[middleId]/minors` | GET | none | 求人/マスタ | N |  |
| `/api/job-categories` | GET | none | 求人/マスタ | N |  |
| `/api/job-categories/[majorId]/middles` | GET | none | 求人/マスタ | N |  |
| `/api/job-categories/all` | GET | none | 求人/マスタ | N |  |
| `/api/job-categories/middles/[middleId]/minors` | GET | none | 求人/マスタ | N |  |
| `/api/jobs/export` | POST | none | 求人/マスタ | N | DUMMY_JOBS（ダミーデータ）を Excel 化するだけ |
| `/api/motivation-categories` | GET | none | 求人/マスタ | N |  |
| `/api/motivation-categories/[majorId]/middles` | GET | none | 求人/マスタ | N |  |
| `/api/motivation-categories/middles/[middleId]/minors` | GET | none | 求人/マスタ | N |  |

---

## 3. 認証あり（対処後 364 件）

以下は棚卸し時点の一覧。§1 で対処した 11 件（削除 1 件を除く）と `/api/ai/schema-check` は本節に含まれるが、
行は §1 の表に残してある（変更履歴として追える形にするため）。`/api/employees` の行は下記のとおり更新済み。

| パス | メソッド | 分類 | データ種別 | 個人情報 | 備考 |
|--|--|--|--|--|--|
| `/api/admin/announcements` | GET | session | 設定 | N |  |
| `/api/admin/announcements/[id]/delete` | DELETE | session | 設定 | N |  |
| `/api/admin/announcements/[id]/update` | PATCH | session | 設定 | N |  |
| `/api/admin/announcements/ai-format` | POST | session | 設定 | N |  |
| `/api/admin/announcements/create` | POST | session | 設定 | N |  |
| `/api/admin/audit` | GET | session | 設定 | N |  |
| `/api/admin/auto-recommend/approve` | POST | session | 設定 | N |  |
| `/api/admin/auto-recommend/candidates/[candidateId]` | GET | session | 設定 | N |  |
| `/api/admin/auto-recommend/line-sent` | POST | session | 設定 | N |  |
| `/api/admin/auto-recommend/overview` | GET | session | 設定 | N |  |
| `/api/admin/auto-recommend/reject` | POST | session | 設定 | N |  |
| `/api/admin/auto-recommend/retry-pdf` | POST | session | 設定 | N |  |
| `/api/admin/candidates/check-deletion-impact` | POST | session | 設定 | N |  |
| `/api/admin/candidates/hard-delete` | POST | session | 設定 | N |  |
| `/api/admin/documents` | GET | session | 設定 | N |  |
| `/api/admin/documents/[id]/delete` | DELETE | session | 設定 | N |  |
| `/api/admin/documents/[id]/update` | PATCH | session | 設定 | N |  |
| `/api/admin/documents/create` | POST | session | 設定 | N |  |
| `/api/admin/employees` | POST | session | 社員 | Y |  |
| `/api/admin/employees/[employeeId]` | GET,PATCH | session | 社員 | Y |  |
| `/api/admin/employees/[employeeId]/dependents` | POST,PATCH,DELETE | session | 社員 | Y |  |
| `/api/admin/employees/[employeeId]/parse-resume` | POST | session | 社員 | Y |  |
| `/api/admin/employees/[employeeId]/secrets` | GET | session | 社員 | Y |  |
| `/api/admin/invites` | POST | session | 設定 | N |  |
| `/api/admin/settings` | GET,POST | session | 設定 | N |  |
| `/api/admin/systems` | GET | session | 設定 | N |  |
| `/api/admin/systems/[id]/update` | POST | session | 設定 | N |  |
| `/api/admin/systems/create` | POST | session | 設定 | N |  |
| `/api/admin/users` | GET | session | 設定 | N |  |
| `/api/admin/users/[id]` | PATCH | session | 設定 | N |  |
| `/api/admin/users/[id]/lineworks-id` | PATCH | session | 設定 | N |  |
| `/api/admin/users/[id]/manus-key` | GET,PATCH,DELETE | session | 設定 | N |  |
| `/api/admin/users/[id]/mynavi-assignee` | PATCH | session | 設定 | N |  |
| `/api/admin/users/[id]/status` | POST | session | 設定 | N |  |
| `/api/ai/company-kpi` | GET | bearer | 設定 | N |  |
| `/api/announcements` | GET | session | その他 | N |  |
| `/api/announcements/[id]` | GET | session | その他 | N |  |
| `/api/announcements/[id]/attachments` | POST | session | その他 | N |  |
| `/api/announcements/[id]/attachments/[attachmentId]` | DELETE | session | その他 | N |  |
| `/api/announcements/[id]/attachments/[attachmentId]/view` | GET | session | その他 | N |  |
| `/api/announcements/latest` | GET | session | その他 | N |  |
| `/api/announcements/recent` | GET | session | その他 | N |  |
| `/api/attendance/admin/approvals` | GET | session | 社員 | Y |  |
| `/api/attendance/admin/employees` | GET,PATCH | session | 社員 | Y |  |
| `/api/attendance/alerts` | GET | session | 社員 | Y |  |
| `/api/attendance/approve/[token]` | GET,POST | session | 社員 | Y |  |
| `/api/attendance/correction` | POST | session | 社員 | Y |  |
| `/api/attendance/correction/[date]` | GET | session | 社員 | Y |  |
| `/api/attendance/debug-events` | GET | session | 社員 | Y |  |
| `/api/attendance/export` | GET | session | 社員 | Y |  |
| `/api/attendance/fix-okada-0414` | GET | session | 社員 | Y |  |
| `/api/attendance/fix-totals` | GET | session | 社員 | Y |  |
| `/api/attendance/history` | GET | session | 社員 | Y |  |
| `/api/attendance/import` | POST | session | 社員 | Y |  |
| `/api/attendance/leave` | POST | session | 社員 | Y |  |
| `/api/attendance/punch` | POST | session | 社員 | Y |  |
| `/api/attendance/punch/edit` | POST | session | 社員 | Y |  |
| `/api/attendance/records` | GET | session | 社員 | Y |  |
| `/api/attendance/status` | GET | session | 社員 | Y |  |
| `/api/auth/consume-invite` | POST | token | 社員 | Y |  |
| `/api/auth/issue-app-token` | POST | session | 社員 | Y |  |
| `/api/auth/login` | POST | session | 社員 | Y |  |
| `/api/auth/logout` | POST | session | 社員 | Y |  |
| `/api/auth/me` | OPTIONS,GET | token | 社員 | Y |  |
| `/api/auth/session` | GET | session | 社員 | Y |  |
| `/api/auth/sso-token` | POST | session | 社員 | Y |  |
| `/api/auth/verify-app-token` | OPTIONS,POST | token | 社員 | Y |  |
| `/api/calendar/auth` | GET | session | その他 | N |  |
| `/api/calendar/callback` | GET | token | その他 | N |  |
| `/api/calendar/disconnect` | DELETE | session | その他 | N |  |
| `/api/calendar/events` | GET | session | その他 | N |  |
| `/api/candidates/[candidateId]` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/context` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/greeting` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/ingest-logs` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/sessions` | GET,POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/sessions/[sessionId]` | DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages` | GET,POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/[messageId]/suggested-tasks` | PATCH | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/analyze-batch` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/extract-text` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/mark-introduced` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/restore-jobs` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/send-to-job-tool` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/to-entry` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bookmarks/unmark-introduced` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bs-folders` | GET,POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/bs-folders/[folderId]` | PATCH,DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/contact-logs` | GET,POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/contact-logs/[logId]` | DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/dashboard` | GET | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/entries` | GET,POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/entries/[entryId]` | PATCH,DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/entries/revert-bulk` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files` | OPTIONS,GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]` | OPTIONS,GET,PATCH,DELETE | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/archive` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/download` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/generate-pdf` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/job-info` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/permanent` | DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/replace-docx` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/replace-xlsx` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/[fileId]/restore` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/attach-to-task` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/bulk-download` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/counts` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/files/upload` | OPTIONS,POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/google-form/create-form` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/google-form/draft` | GET,PUT,DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/google-form/extract-resume` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/google-form/generate-form` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/google-form/regenerate-questions` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/google-form/request` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/guides/[guideType]` | GET,PATCH | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/guides/[guideType]/token` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/interviews` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/interviews/ai-organize` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/issue-site-token` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/job-introductions` | DELETE | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/jobs` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/mypage` | GET | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/notes` | GET,POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/notes/[noteId]` | DELETE | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/onedrive-sync-now` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/recommend-collect` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/recommend-conditions` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/recommend-now` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/saved-jobs` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/settings-history` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/share-link` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/site-guide-draft` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/site-preview-url` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/summarize-end-comment` | POST | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/sync-ca-comments` | POST | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/tasks` | GET | session | 求職者 | Y |  |
| `/api/candidates/[candidateId]/update` | PATCH | session+secret | 求職者 | Y |  |
| `/api/candidates/[candidateId]/work-histories` | GET | session | 求職者 | Y |  |
| `/api/candidates/next-number` | GET | session | 求職者 | Y |  |
| `/api/candidates/parse-resume` | POST | session | 求職者 | Y |  |
| `/api/candidates/search` | GET | session | 求職者 | Y |  |
| `/api/daily-report` | GET,POST | session | その他 | N |  |
| `/api/daily-report/assist` | POST | session | その他 | N |  |
| `/api/daily-report/chat` | POST | session | その他 | N |  |
| `/api/daily-report/comments` | GET,POST,DELETE | session | その他 | N |  |
| `/api/documents` | GET | session | その他 | N |  |
| `/api/documents/[id]` | GET | session | その他 | N |  |
| `/api/employees` | GET,OPTIONS | session+secret | 社員 | Y | T-191: 既定は session 必須に変更。includeInactive のみ x-api-key |
| `/api/entries` | GET,POST | session | 求職者 | Y |  |
| `/api/entries/[entryId]` | GET,PATCH,DELETE | session | 求職者 | Y |  |
| `/api/entries/[entryId]/flags` | PATCH | session | 求職者 | Y |  |
| `/api/entries/[entryId]/sync-task` | POST | session | 求職者 | Y |  |
| `/api/entries/auto-progress` | POST | session | 求職者 | Y |  |
| `/api/entries/bulk-archive` | POST | session | 求職者 | Y |  |
| `/api/entries/bulk-delete` | POST | session | 求職者 | Y |  |
| `/api/entries/bulk-flags` | PATCH | session | 求職者 | Y |  |
| `/api/entries/export` | GET | session | 求職者 | Y |  |
| `/api/entries/generate-end-notice` | POST | session | 求職者 | Y |  |
| `/api/entries/generate-message` | POST | session+secret | 求職者 | Y |  |
| `/api/entry-flags` | GET | session | その他 | N |  |
| `/api/external/bookmarks/from-job-platform` | POST | secret | その他 | N |  |
| `/api/external/candidate-birthday/[candidateNo]` | GET | secret | その他 | N |  |
| `/api/external/candidate-response` | POST,OPTIONS | secret | その他 | N |  |
| `/api/external/candidate-site/activity-log` | POST | secret | 求職者 | Y |  |
| `/api/external/candidate-site/applications` | GET | secret | 求職者 | Y |  |
| `/api/external/candidate-site/apply` | POST | secret | 求職者 | Y |  |
| `/api/external/candidate-site/auto-matches` | GET | secret | 求職者 | Y |  |
| `/api/external/candidate-site/display-order` | PATCH | secret | 求職者 | Y |  |
| `/api/external/candidate-site/display-overrides` | PATCH | secret | 求職者 | Y |  |
| `/api/external/candidate-site/favorites` | GET,POST,PATCH,DELETE | secret | 求職者 | Y |  |
| `/api/external/candidate-site/pickup` | PATCH | secret | 求職者 | Y |  |
| `/api/external/candidate-site/preferences` | GET | secret | 求職者 | Y |  |
| `/api/external/candidate-site/questions` | POST | secret | 求職者 | Y |  |
| `/api/external/candidate-site/questions/summarize` | POST | secret | 求職者 | Y |  |
| `/api/external/candidate-site/response-status` | PATCH | secret | 求職者 | Y |  |
| `/api/external/candidate-site/response-submission` | POST | secret | 求職者 | Y |  |
| `/api/external/candidate-summary/[jobSeekerId]` | GET | secret | その他 | N |  |
| `/api/external/candidates/search` | GET | secret | その他 | N |  |
| `/api/external/create-schedule-task` | POST | secret | その他 | N |  |
| `/api/external/extraction-complete` | POST,OPTIONS | secret | その他 | N |  |
| `/api/external/recommend/enabled-candidates` | GET | secret | その他 | N |  |
| `/api/external/saved-jobs` | POST | secret | その他 | N |  |
| `/api/external/schedule-agent/resolve` | POST | secret | その他 | N |  |
| `/api/external/schedule-tasks` | GET | secret | その他 | N |  |
| `/api/external/schedule-tasks/[taskId]` | PATCH | secret | その他 | N |  |
| `/api/external/scout-plan` | GET | secret | その他 | N |  |
| `/api/external/scout-plan/[id]/reflect` | PATCH | secret | その他 | N |  |
| `/api/guides/[token]` | GET,PATCH | token | 求職者 | Y |  |
| `/api/internal/ai-usage` | POST | secret | その他 | N |  |
| `/api/internal/bookmarks/resubmit-stale` | POST | secret | その他 | N |  |
| `/api/internal/candidates/[candidateNumber]/job-history` | GET | secret | その他 | N |  |
| `/api/internal/candidates/[candidateNumber]/type-diagnosis` | GET | secret | その他 | N |  |
| `/api/internal/entries/auto-expire` | POST | secret | その他 | N |  |
| `/api/internal/entries/auto-purge` | POST | secret | その他 | N |  |
| `/api/internal/entries/bulk-import` | POST,DELETE | secret | その他 | N |  |
| `/api/internal/entries/cowork-export` | GET | secret | その他 | N |  |
| `/api/internal/onedrive-sync/retry` | POST | secret | その他 | N |  |
| `/api/internal/recommend/analyze-collect` | POST | secret | その他 | N |  |
| `/api/internal/recommend/analyze-submit` | POST | secret | その他 | N |  |
| `/api/internal/recommend/expire` | POST | secret | その他 | N |  |
| `/api/internal/secure-transfer-cleanup` | POST | secret | その他 | N |  |
| `/api/internal/staff` | GET | secret | 社員 | Y |  |
| `/api/internal/staff/[userId]` | GET | secret | 社員 | Y |  |
| `/api/internal/tasks/due-reminder` | POST | secret | その他 | N |  |
| `/api/interview-support/[interviewId]/prior-info` | GET | session | その他 | N |  |
| `/api/interview-support/[interviewId]/session` | POST | session | その他 | N |  |
| `/api/interview-support/auto-scan` | POST | session | その他 | N |  |
| `/api/interview-support/explain` | POST | session | その他 | N |  |
| `/api/interview-support/sessions` | GET | session | その他 | N |  |
| `/api/interview-support/sessions/[sessionId]` | GET,DELETE | session | その他 | N |  |
| `/api/interview-support/stt-token` | POST | session | その他 | N |  |
| `/api/interviews` | GET,POST | session | 求職者 | Y |  |
| `/api/interviews/[id]` | GET,PATCH,DELETE | session | 求職者 | Y |  |
| `/api/interviews/[id]/analyze-with-intake` | POST | session+secret | 求職者 | Y |  |
| `/api/interviews/[id]/attachments` | GET,POST | session | 求職者 | Y |  |
| `/api/interviews/[id]/attachments/[attachmentId]` | GET,PATCH,DELETE | session | 求職者 | Y |  |
| `/api/interviews/[id]/suggested-tasks` | PATCH | session | 求職者 | Y |  |
| `/api/interviews/[id]/work-histories` | GET,PUT,POST | session | 求職者 | Y |  |
| `/api/interviews/[id]/work-histories/[whId]` | PATCH,DELETE | session | 求職者 | Y |  |
| `/api/interviews/analyze` | POST | session | 求職者 | Y |  |
| `/api/jimu-report` | POST | token | 求職者 | Y |  |
| `/api/jimu/[token]` | GET,PUT | token | 求職者 | Y |  |
| `/api/manuals` | GET | session | その他 | N |  |
| `/api/manuals/[id]` | GET | session | その他 | N |  |
| `/api/manuals/[id]/delete` | DELETE | session | その他 | N |  |
| `/api/manuals/[id]/update` | PATCH | session | その他 | N |  |
| `/api/manuals/create` | POST | session | その他 | N |  |
| `/api/manuals/upload-pdf` | POST | session | その他 | N |  |
| `/api/master/candidates` | GET,POST | session | 設定 | N |  |
| `/api/master/candidates/bulk-update` | POST | session | 設定 | N |  |
| `/api/masters/banks/[code]` | GET | session | 設定 | N |  |
| `/api/masters/banks/[code]/branches/[branchCode]` | GET | session | 設定 | N |  |
| `/api/masters/postal-code/[code]` | GET | session | 設定 | N |  |
| `/api/performance` | GET | session | その他 | N |  |
| `/api/performance/advisors` | GET | session | その他 | N |  |
| `/api/performance/cohort` | GET | session | その他 | N |  |
| `/api/performance/detail` | GET | session | その他 | N |  |
| `/api/performance/monthly` | GET | session | その他 | N |  |
| `/api/performance/target` | GET,POST | session | その他 | N |  |
| `/api/performance/target/reference` | GET | session | その他 | N |  |
| `/api/performance/weekly` | GET | session | その他 | N |  |
| `/api/rpa-error/chat` | POST,GET | session | 求職者 | Y |  |
| `/api/rpa-error/chat/[chatId]` | GET | session | 求職者 | Y |  |
| `/api/rpa-error/chat/[chatId]/extract` | POST | session | 求職者 | Y |  |
| `/api/rpa-error/chat/[chatId]/message` | POST | session | 求職者 | Y |  |
| `/api/rpa-error/executions` | GET | session | 求職者 | Y |  |
| `/api/rpa-error/executions/[batchId]` | GET | session | 求職者 | Y |  |
| `/api/rpa-error/known-errors` | GET,POST | session | 求職者 | Y |  |
| `/api/rpa-error/known-errors/[id]` | PATCH,DELETE | session | 求職者 | Y |  |
| `/api/rpa-error/known-errors/check-duplicate` | POST | session | 求職者 | Y |  |
| `/api/rpa-error/logs` | GET,POST | session | 求職者 | Y |  |
| `/api/rpa-error/logs/[id]` | GET,PATCH | session | 求職者 | Y |  |
| `/api/rpa-error/logs/[id]/notes` | POST | session | 求職者 | Y |  |
| `/api/rpa-error/stats` | GET | session | 求職者 | Y |  |
| `/api/rpa-error/users` | GET | session | 求職者 | Y |  |
| `/api/rpa-scout/dashboard` | GET | session | 求職者 | Y |  |
| `/api/rpa-scout/job-categories` | GET | session | 求職者 | N |  |
| `/api/rpa-scout/logs` | GET,POST | session | 求職者 | Y |  |
| `/api/rpa-scout/machines` | GET | session | 求職者 | Y |  |
| `/api/rpa-scout/patterns` | GET,POST | session | 求職者 | Y |  |
| `/api/rpa-scout/patterns/[id]` | PATCH | session | 求職者 | Y |  |
| `/api/rpa-scout/plans` | GET,POST | session | 求職者 | Y |  |
| `/api/rpa-scout/plans/[id]` | PATCH,DELETE | session | 求職者 | Y |  |
| `/api/rpa-scout/plans/[id]/execute` | POST,DELETE | session | 求職者 | Y |  |
| `/api/rpa-scout/templates` | GET,POST | session | 求職者 | Y |  |
| `/api/rpa-scout/templates/[id]` | PATCH | session | 求職者 | Y |  |
| `/api/rpa/mynavi/batch-finish` | POST | secret | 求職者 | Y |  |
| `/api/rpa/mynavi/batch-start` | POST | secret | 求職者 | Y |  |
| `/api/rpa/mynavi/last-execution` | GET | secret | 求職者 | Y |  |
| `/api/rpa/mynavi/pdf-upload` | POST | secret | 求職者 | Y |  |
| `/api/rpa/mynavi/reply-sent` | POST | secret | 求職者 | Y |  |
| `/api/rpa/scout/import-failed` | POST | secret | 求職者 | Y |  |
| `/api/schedule` | GET,POST | session | その他 | N |  |
| `/api/schedule-links` | POST | session | 求職者 | Y |  |
| `/api/schedule-links/[token]` | GET,OPTIONS | token | 求職者 | Y |  |
| `/api/schedule/[id]` | PUT,DELETE | session | その他 | N |  |
| `/api/schedule/[id]/chat-history` | GET | session | その他 | N |  |
| `/api/schedule/[id]/status` | PATCH | session | その他 | N |  |
| `/api/schedule/[id]/sync-calendar` | POST | session | その他 | N |  |
| `/api/schedule/chat` | POST | session | その他 | N |  |
| `/api/schedule/entry` | POST | session | その他 | N |  |
| `/api/schedule/entry/[entryId]` | PATCH,DELETE | session | その他 | N |  |
| `/api/schedule/entry/[entryId]/complete` | PATCH | session | その他 | N |  |
| `/api/schedule/review` | POST | session | その他 | N |  |
| `/api/schedule/review/save` | POST | session | その他 | N |  |
| `/api/scout/backfill-delivery-date` | POST | secret | 求職者 | Y |  |
| `/api/scout/candidates` | GET | session | 求職者 | Y |  |
| `/api/scout/candidates/link` | POST,DELETE | session | 求職者 | Y |  |
| `/api/scout/cron/create-daily-slots` | POST | secret | 求職者 | Y |  |
| `/api/scout/import/aggregated` | POST | secret | 求職者 | Y |  |
| `/api/scout/import/daily-excel` | POST | secret | 求職者 | Y |  |
| `/api/scout/import/daily-excel-base64` | POST | secret | 求職者 | Y |  |
| `/api/scout/import/filemaker-legacy` | POST | session | 求職者 | Y |  |
| `/api/scout/import/send-records` | POST | secret | 求職者 | Y |  |
| `/api/scout/masters` | GET | session | 求職者 | Y |  |
| `/api/scout/open-count` | POST | session | 求職者 | Y |  |
| `/api/scout/slots` | GET,PATCH | session | 求職者 | Y |  |
| `/api/scout/slots/create-manual` | POST | session | 求職者 | Y |  |
| `/api/scout/slots/duplicate` | POST | session | 求職者 | Y |  |
| `/api/scout/slots/list` | GET | session | 求職者 | Y |  |
| `/api/scout/stats` | GET | session | 求職者 | Y |  |
| `/api/share/[token]/download-all` | GET | token | 求職者 | Y |  |
| `/api/share/[token]/download/[fileId]` | GET | token | 求職者 | Y |  |
| `/api/share/[token]/verify` | POST | token | 求職者 | Y |  |
| `/api/systems` | GET | session | その他 | N |  |
| `/api/task-categories` | GET,POST | session | 求人/マスタ | N |  |
| `/api/task-categories/[categoryId]` | PUT,DELETE | session | 求人/マスタ | N |  |
| `/api/task-categories/[categoryId]/fields` | GET,POST | session | 求人/マスタ | N |  |
| `/api/task-categories/[categoryId]/fields/[fieldId]` | PUT,DELETE | session | 求人/マスタ | N |  |
| `/api/task-category-groups` | GET,POST | session | その他 | N |  |
| `/api/task-category-groups/[groupId]` | PUT,DELETE | session | その他 | N |  |
| `/api/task-fields/[fieldId]/options` | POST | session | その他 | N |  |
| `/api/task-fields/[fieldId]/options/[optionId]` | PUT,DELETE | session | その他 | N |  |
| `/api/tasks` | GET,POST | session | 求職者 | Y |  |
| `/api/tasks/[taskId]` | GET,PUT,DELETE | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/attachments` | GET,POST | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/attachments/[attachmentId]` | DELETE | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/attachments/bulk-download` | POST | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/attachments/save-to-candidate` | POST | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/clone` | POST | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/comments` | GET,POST | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/comments/[commentId]` | PUT,DELETE | session | 求職者 | Y |  |
| `/api/tasks/[taskId]/status` | PATCH | session | 求職者 | Y |  |
| `/api/tasks/ai-organize` | POST | session | 求職者 | Y |  |
| `/api/tasks/bulk-create-3point` | POST | session | 求職者 | Y |  |
| `/api/tasks/reorder` | PUT | session | 求職者 | Y |  |
| `/api/templates` | GET | session | その他 | N |  |
| `/api/templates/[fileId]/download` | GET | session | その他 | N |  |
| `/api/training-materials` | GET,POST | session | 社員 | Y |  |
| `/api/training-materials/[id]` | PATCH,DELETE | session | 社員 | Y |  |
| `/api/training/check-items` | GET,POST | session | 社員 | Y |  |
| `/api/training/check-items/[id]` | PATCH,DELETE | session | 社員 | Y |  |
| `/api/training/quiz-attempts` | POST,GET | session | 社員 | Y |  |
| `/api/training/quiz-attempts/[id]` | GET | session | 社員 | Y |  |
| `/api/training/quiz-stats` | GET | session | 社員 | Y |  |
| `/api/training/reflection-stats` | GET | session | 社員 | Y |  |
| `/api/training/reflections` | POST,GET | session | 社員 | Y |  |
| `/api/training/work` | GET,POST | session | 社員 | Y |  |
| `/api/training/work-stats` | GET | session | 社員 | Y |  |
| `/api/transfer/[token]/download/[fileId]` | GET | token | 求職者 | Y |  |
| `/api/transfer/[token]/status` | GET | token | 求職者 | Y |  |
| `/api/transfer/[token]/verify` | POST | token | 求職者 | Y |  |
| `/api/transfers` | GET,POST | session | 求職者 | Y |  |
| `/api/transfers/[id]` | GET | session | 求職者 | Y |  |
| `/api/transfers/[id]/revoke` | POST | session | 求職者 | Y |  |
| `/api/transfers/templates/messages` | GET,POST | session | 求職者 | Y |  |
| `/api/transfers/templates/messages/[id]` | PATCH | session | 求職者 | Y |  |
| `/api/transfers/templates/recipients` | GET,POST | session | 求職者 | Y |  |
| `/api/transfers/templates/recipients/[id]` | PATCH | session | 求職者 | Y |  |
| `/api/transfers/upload-url` | POST | session | 求職者 | Y |  |
| `/api/users/me` | GET | session | 社員 | Y |  |
| `/api/users/me/manus-key` | OPTIONS,GET | session | 社員 | Y |  |
