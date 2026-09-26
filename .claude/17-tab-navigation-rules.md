# タブ挙動ルール（一覧→詳細の開き方）

基本方針は `14-ui-component-map.md` の T-139 セクション（portal 内の画面移動は同一タブ、別システム・ファイル・外部サイト・タスク作成ウィザードは新規タブ）。
このファイルは、その例外として「一覧→詳細」を新規タブにした導線と、その変更履歴をまとめる。

## 2026-09-05 変更（79c95d4 / 2feb88f）

| 画面 | 導線 | 挙動 | ファイル |
|--|--|--|--|
| 求職者管理 | 氏名 → 求職者詳細 | 新規タブ | `src/app/(app)/admin/master/CandidateListClient.tsx` |
| 求職者詳細タスク欄 | タスクタイトル → タスク詳細 | 新規タブ | `src/components/candidates/CandidateDetailPage.tsx` |
| エントリー管理 | 求職者名 → 求職者詳細 | 新規タブ | `src/components/entries/EntryTable.tsx` |

※ この時点では、このファイルは存在せず、上表は 2026-09-26 にコミット履歴から起こした。

## 2026-09-26 変更

| 画面 | 導線 | 挙動 | ファイル |
|--|--|--|--|
| 面談管理 | 求職者氏名 → 求職者詳細（`?view=interview&from=interviews`） | **新規タブ**（`<Link target="_blank" rel="noopener noreferrer">`）。行クリックは無し。操作列の ✎・🗑 は同一タブのまま | `src/app/(app)/admin/interviews/InterviewListClient.tsx` |
| 求職者管理 | 氏名 → 求職者詳細 | **同一タブに戻した**（上表 2026-09-05 の求職者管理の行は無効） | `src/app/(app)/admin/master/CandidateListClient.tsx` |
| タスク管理 | タスク詳細で完了 | 一覧→詳細は同一タブのまま。**完了が成功したら `/tasks` へ自動遷移**（`router.push("/tasks")` + `router.refresh()`）。失敗時は遷移せず alert のまま | `src/app/(app)/tasks/[taskId]/page.tsx` |

- 求職者詳細タスク欄・エントリー管理の求職者名は新規タブのまま（変更なし）。
- タスク完了の遷移は `handleStatusChange` 1か所で行う。「完了」ボタン、全員完了タイプの「自分を完了」「完了する」、ステータスのプルダウンで「完了」を選ぶ、がすべてここを通る。確認ダイアログは無い。「未完了に戻す」等、完了以外への変更では遷移しない。
- `/tasks/new` への `window.open`（`EntryBoard.tsx` / `InterviewForm.tsx`）は T-139 の例外のまま変更禁止。

### 追加した sessionStorage（作法は `interviewlist-filters` と同じ）

| キー | 画面 | 保存項目 |
|--|--|--|
| `candidatelist-filters` | 求職者管理 | `supportTab / caFilter / search / dateFrom / dateTo / appDateFrom / appDateTo / delDateFrom / delDateTo / routeFilter / mediaFilter / genderFilter / autoFilter / endReasonFilter / desiredSort / currentPage` |
| `tasklist-filters` | タスク管理 | `viewMode / includeCompleted / filterStatus / filterGroupId / filterCategoryId / filterPriority / filterCandidateName / filterAssigneeId / page`（列ソート・ドラッグの並び順は保存しない） |

- 復元はマウント時、`restored` フラグ ON 以降だけ保存する（復元前の既定値で上書きしない）。読み書きは try-catch で、破損データ・quota・private mode は無視して既定値で動く。
- 復元値は既定値より優先する（求職者管理の担当CA＝ログインユーザー、など）。
- 求職者管理の「クリア」は state を空に戻すので、保存値もそのまま空に上書きされる（支援タブ・並び替えは従来どおりクリア対象外）。
- 求職者管理・タスク管理とも、URL クエリで絞り込みを受け取る導線は今は無い。URL で開く導線を足すときは、EntryBoard の `initialCandidateName` と同じく、URL 指定時は復元をスキップすること。
- 求職者管理の検索 debounce は、マウント時にも走って 300ms 後にページを 1 に戻していた（復元したページが消える）。`appliedSearchRef` で「検索語が変わったときだけ」走るようにした。`InterviewListClient` の debounce にも同じ作りが残っていて、復元したページが 1 に戻る可能性がある（今回は触っていない）。
- タスク一覧は `fetchTasks` 冒頭で `if (!restored) return;` して二重取得を防ぐ。一覧はクライアント側でマウント時に取り直すので、完了後に戻れば最新になる。
