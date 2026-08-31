# T-161(仮) 調査報告：ブックマーク/求人紹介の件数不一致・サイト経由求人の情報欠落・担当RC表示消失

- 対象リポジトリ: bizstudio-portal（worktree `C:\bizstudio\portal-2` / ブランチ `sagyou-2`）
- 調査日: 2026-08-13（JST）
- 実データ確認: `railway ssh --service bizstudio-portal` 経由の SELECT のみ（書き込み一切なし）
- 主な観測対象: 小林 晶果 / 求職者番号 **5008248**（candidateId `cmrnc5tcf001r1ds4p6tiw306`）
- 本書は調査報告のみ。ソースコードの変更は行っていない。

---

## 1. 結論サマリ（5項目）

### ① タブ件数が一致しない理由

**CAの認識「ブックマークの件数に紹介保留は含んでいない」は正しい。件数不一致はバグではなく、4タブが別々のデータ源を数えていることによる構造的な差である。**

実測（5008248）:

| 表示 | 実測値 | 数えているもの |
|--|--|--|
| ブックマーク 47 | 47 | portal `candidate_files` category=BOOKMARK **かつ archived_at IS NULL** |
| 紹介保留 5 | 5 | 同上で **archived_at IS NOT NULL**（ブックマーク47とは排他・重複なし） |
| 求人紹介 42 | 42 | **kyuujin-pdf-tool 側**の求人レコード数（portal のブックマークは1件も参照していない） |
| エントリー 13 | 13 | portal `job_entries`（全件・isActive/archived で絞っていない） |
| 評価内訳ドーナツ 41 | 41 | ブックマーク47 − AI評価対象外6 |

47 と 42 の差 5 は「引き算1つ」ではなく **2つの独立した差の合成**である。

```
47（ブックマーク）
 − 6（サイト経由。kyuujin 側に求人が存在しないので求人紹介に出ない）
 = 41
 + 1（kyuujin 側にだけ存在する重複求人 job_id=10858「国光オブラート株式会社」。portal にブックマーク行なし）
 = 42（求人紹介）
```

差の内訳は §7.1 に会社名で全件列挙した。

### ② 求人サイト経由の自己応募が求人紹介に反映されない理由

**求人紹介タブは kyuujin-pdf-tool の `GET /api/projects/by-job-seeker-id/{求職者番号}/jobs` の戻り値をそのまま表示しており、portal のブックマークテーブルを一切見ていない。したがって「kyuujin 側に求人レコードが作られたか」だけが唯一の出現条件である。**

条件式として言い切ると:

> ブックマーク行が求人紹介タブに現れる ⟺
> （kyuujin-pdf-tool の当該求職者プロジェクトに対応 job が存在する）∧（portal `hidden_job_introductions` に当該 job.id が無い）∧（`candidates.candidate_number` が非NULL）

サイト経由（`origin="candidate"` かつ `drive_file_id IS NULL`）は **PDF実体を持たない**。kyuujin へ求人を作る唯一の経路が「PDFをアップロードして抽出させる」ことなので、PDFが無い＝kyuujin に job が作れない＝求人紹介タブに構造上出せない。

**さらに悪い挙動が実在する（本件の実害）**: `POST /bookmarks/send-to-job-tool` は、同一リクエストに含まれたサイト経由行を PDF送信分と一緒に `last_exported_at` で「出力済」に更新する（`send-to-job-tool/route.ts:386-402`）。5008248 のサイト経由6件は全件 `last_exported_at=2026-08-13 18:38 JST` が立っている。つまり **画面には「出力済」バッジが付くのに求人紹介タブには一生出てこない**。CAから見ると「送ったはずなのに出ない」に見える。加えてこの6件は日報の「出力数／選定率」の分子に乗る（§9）。

### ③ サイト経由エントリーに求人情報が残らない理由

**値が「存在しない」のではなく、「portal 側が最初から取りに行っていない／保存していない」。**

- サイト経由ブックマークを作る `POST /api/external/candidate-site/favorites` は、mypage から **`jobTitle` を受け取っているのに捨てている**（`favorites/route.ts:283`  `void jobTitle;`。コメントで「CandidateFile に専用列が無いため保持しない」と明記）。職種・勤務地・年収は受け取ってすらいない。会社名は `file_name`（`求人票_{会社名}.pdf`）に埋め込む形でしか残らない。
- そこからエントリーを作る `POST /bookmarks/to-entry` は **`jobTitle: ""` を固定で入れ、`jobCategory` は一切セットしない**（`to-entry/route.ts:118-119` 付近）。
- 紹介履歴タブのエントリー一覧は、職種バッジ＝`jobCategory`、求人タイトル＝`jobTitle` を直接表示する（`HistoryTab.tsx:3765,3776`）。したがって両方とも必ず空欄になる。

つまり **元データ（job-platform）には職種も求人タイトルも存在するが、portal は受け口・中継・保存のいずれの段でも運んでいない**。復元は「job-platform / kyuujin から取り直す」しかない。

規模: `route="site-apply"` のエントリーは全社 **36件**。うち `job_title=""` が **34件**、`job_category` 空が **36件（全件）**。対象求職者は 6名（5008152 高田 凌 16件、5007978 北島 友香 13件、5004595 東 幸汰 3件、5008186 森田 倫名 2件、5008248 小林 晶果 2件）。

### ④ 更新後に担当RCの表示が消える理由と、他に消えている項目

**原因は特定できた。API レスポンスの `include` 漏れ＋クライアント側の丸ごと差し替え。**

- 一覧取得 `GET /api/entries` は `candidate: { select: { …, recruiterName: true, employee: {…} } }` を返す（`entries/route.ts:92`）。
- 更新 `PATCH /api/entries/[entryId]`（`[entryId]/route.ts:143-155`）と `PATCH /api/entries/[entryId]/flags`（`flags/route.ts:98-109`）の `include` には **`recruiterName` が入っていない**。
- `EntryBoard` は更新レスポンスで行オブジェクトを**丸ごと差し替える**（`EntryBoard.tsx:622, 645, 774, 1423, 1436`）。結果 `entry.candidate.recruiterName` が `undefined` になり、担当RC列が「-」になる。DBの値は無傷なのでリロードで戻る。

**同じ理由で消える他の項目は無い。** PATCH 側の `include` には `id / name / candidateNumber / employeeId / employee.name` が揃っており、担当CA・求職者名・求職者番号は保持される。欠けているのは `recruiterName` **1列だけ**である（`EntryTable.tsx` が `entry.candidate.*` を参照するのは上記6項目のみ。`EntryTable.tsx:281-283, 916-938`）。

**副作用がもう1つある**: 一覧を「担当RC」列でソートしている状態で更新すると、その行だけソートキーが null 扱いになり **並び順が飛ぶ**（`EntryTable.tsx:283` の `getFieldValue`）。担当RC絞り込み自体はサーバ側実装なので行が消えることはない。

この不具合は **他の3件と技術的に完全に独立しており、単独で先に修正できる**（§11）。

### ⑤ 出力なしで「紹介済み」にする場合の最大のリスク

`last_exported_at` は現在 **「CAが求人ツールへ出力した」という行動量の実測値**として、日報の求人検索グラフ（出力数・選定率）と週次実績マトリクス（求人紹介＝提案ステージ）の**分子そのもの**に使われている。ここに「出力していないが紹介扱いにしたい」行を混ぜると、

**最大のリスク＝日報の「選定率」と実績表の「求人紹介（提案）人数」が過去に遡って水増しされ、CA個人の行動量評価の数字が変わる。**（`jobSearch.ts:27` は当日 `last_exported_at` を無条件カウント、`weeklyMatrix.ts:115-124, 180-187, 344-352` と `performance/detail/route.ts:143-148` は `last_exported_at` を提案日として JobEntry と UNION する。`metrics.ts:169` も同様。）

これは「集計が少しズレる」ではなく **人事評価に使われている数字が変わる** という性質のリスクなので、`last_exported_at` の流用は避け、別カラム新設が妥当（§9 の案A/案B）。

---

## 2. 4タブの件数条件の対応表（項目A）

| タブ | 件数を出している箇所 | 呼んでいるAPI | 絞り込み条件 |
|--|--|--|--|
| **ブックマーク** | `HistoryTab.tsx:3443-3445`（`bookmarkCount`、`:2969` 定義／`:1087-1096` の `BookmarkSection.fetchFiles` が `onCountChange` で親へ通知） | `GET /api/candidates/{id}/files?category=BOOKMARK` | `candidate_id` ∧ `category='BOOKMARK'` ∧ **`archived_at IS NULL`**（`files/route.ts:52-62`）。`origin` / `drive_file_id` / `last_exported_at` では絞らない |
| **求人紹介** | `HistoryTab.tsx:3456-3458`（`totalJobs = jobsData.total_jobs`、`:3403`／`fetchJobs` は `:3108-3124`） | `GET /api/candidates/{id}/jobs` → 内部で kyuujin `GET {KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/{candidateNumber}/jobs`（`jobs/route.ts:46`） | **portal のテーブルは母数に一切関与しない**。kyuujin の返した `total_jobs` から `hidden_job_introductions` に載る `external_job_id` を除外（`jobs/route.ts:73-92`）。`candidate_number` が NULL なら 0 固定（`:30`） |
| **エントリー** | `HistoryTab.tsx:3469-3471`（`entries.length`、`fetchEntries` は `:3126-3139`） | `GET /api/candidates/{id}/entries` | `job_entries.candidate_id` のみ（`entries/route.ts:16-19`）。**`is_active` / `archived_at` / `entry_flag` で絞らない＝失効・アーカイブ済みも件数に入る** |
| **紹介保留** | `HistoryTab.tsx:3482-3484`（`archivedCount`、`fetchArchivedCount` は `:3141-3149`） | `GET /api/candidates/{id}/files?category=BOOKMARK&archived=true` | `category='BOOKMARK'` ∧ **`archived_at IS NOT NULL`**（`files/route.ts:56-57`）。ブックマークタブと排他 |

### 評価内訳ドーナツの母数（41）

`HistoryTab.tsx:1330-1368` の `ratingSummary`。

```
母数 total = filteredFiles（＝ブックマークタブの表示中47件。検索・日付絞り込み後）
             − { origin === "candidate" かつ drive_file_id が無く かつ ai_analysis_comment も無い 行 }
```

除外条件は `HistoryTab.tsx:1331-1333`。この除外分が画面表示の「AI評価対象外 N件」（`:897`）。

5008248 の実測: 47 − 6 = **41**。除外6件は §7.1 の表に一致する。

---

## 3. 求人紹介タブのデータ源と必要条件（項目B）

### データ源

**kyuujin-pdf-tool（外部）のみ。** portal は中継しているだけ。

- エンドポイント: `GET {KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/{candidateNumber}/jobs`
- 紐づけキー: **`candidates.candidate_number`（求職者番号）**。kyuujin 側の「求職者プロジェクト」を求職者番号で引く。5008248 → `project_id=391`。
- portal 側の後処理（`jobs/route.ts`）
  - `company_name` 末尾の `_YYYYMMDDHHMMSS` を除去（`:7`）
  - `hidden_job_introductions` にある `external_job_id` を除外し `total_jobs` を再計算（`:85-93`）
  - `candidate_job_responses` から `candidate_response` / `candidate_responded_at` を付与（`:95-107`）
- タイムアウト10秒。kyuujin が 404 なら `{jobs: [], total_jobs: 0}`、それ以外のエラーは 502。

### portal 側ブックマークが求人紹介タブに現れるための必要条件（言い切り）

> **求人紹介タブに出る ⟺ kyuujin-pdf-tool 側に、その求人に対応する `job` レコードが当該求職者プロジェクト配下に存在する。**
>
> その `job` は **PDF実体（`candidate_files.drive_file_id`）を kyuujin にアップロードして抽出させたときにだけ**作られる（`send-to-job-tool/route.ts` のメインフロー）。
>
> ゆえに `drive_file_id IS NULL` のブックマークは、`last_exported_at` に何を入れても求人紹介タブには出ない。

**重要な誤解の訂正**: `last_exported_at`（＝「出力済」バッジ）は求人紹介タブの出現条件では**ない**。portal 側の記録に過ぎない。実データがそれを証明している（5008248 のサイト経由6件は `last_exported_at` あり・求人紹介タブには不在）。

`send-to-job-tool/route.ts:66-71` のコメントは「サイト経由＝求職者がマイページで応募した求人＝kyuujin 側に既に job が存在する」と書いているが、**これは新サイト（`/site/` favorites 経由）には当てはまらない**。旧マイページ webhook 由来（`ensureBookmarkForMypageResponse`）だけが kyuujin job を持つ。この前提の食い違いが、サイト経由行が「出力済」だけ立って求人紹介に出ない挙動の直接の原因になっている。

---

## 4. サイト経由ブックマークの発生経路と保持している/していない情報（項目C）

### `origin="candidate"` を書き込んでいる箇所（全4か所）

| # | 経路 | ファイル | 誰が起点か |
|--|--|--|--|
| 1 | 新サイト（bizstudio-mypage `/site/`）の「お気に入り追加」 | `src/app/api/external/candidate-site/favorites/route.ts:276` | 求職者本人（mypage BFF が共有鍵で POST） |
| 2 | 旧マイページ回答 webhook の受け皿 | `src/lib/mypage-response-sync.ts:501`（`ensureBookmarkForMypageResponse`、呼び出しは `api/external/candidate-response/route.ts:104`） | 求職者本人（kyuujin webhook 経由） |
| 3 | 過去分バックフィル | `scripts/backfill-site-response-bookmarks.ts:284` | 運用バッチ（#2 相当を後追い生成） |
| 4 | `bookmarks/to-entry` の**対象条件**として参照（作成はしない） | `src/app/api/candidates/[candidateId]/bookmarks/to-entry/route.ts:53` | — |

**bizstudio-job-platform からの CA 側投入（`api/external/bookmarks/from-job-platform`）は `origin` を立てない**（＝CA追加扱い）。

### 経路1（新サイト favorites）で作成時にセットされる列

`favorites/route.ts:264-286`

| 列 | 値 | 備考 |
|--|--|--|
| `category` | `"BOOKMARK"` | |
| `origin` | `"candidate"` | |
| `source_type` | `"job-platform"` | |
| `external_job_ref` | job-platform の `source_job_id`（`hl-ap-314617` / `circus-ye9ft9` / `own-rkrmzb` 等） | **これが唯一の求人同定キー** |
| `file_name` | `求人票_{会社名}[_{数値ID}].pdf` | **会社名はここにしか無い（専用列なし）** |
| `drive_file_id` / `drive_view_url` / `drive_folder_id` | **すべて NULL** | PDF実体なし |
| `kyuujin_job_id` | **NULL**（セットしない） | kyuujin に job が無いため |
| `mime_type` | `"text/plain"` | |
| `file_size` | extractedText のバイト数 or 0 | |
| `memo` | 求人URL（`body.jobUrl`） | 求人URLは `memo` 列に入る |
| `candidate_note` | 本人メモ（任意） | |
| `extracted_text` / `extracted_at` | 渡ってきた場合のみ | |
| `last_exported_at` / `last_exported_to` | **NULL（作成時）** | 後から send-to-job-tool が誤って立てる（§1②） |
| `ai_analysis_comment` / `ai_match_rating` / `ai_analyzed_at` | **NULL** | AI分析を一切起動しない設計 |
| `source_media` | **セットしない（NULL）** | 媒体は `external_job_ref` の接頭辞から推定するしかない |
| **職種にあたる値** | **保持列そのものが存在しない** | 受け取ってもいない |
| **求人タイトル** | **受け取っているが破棄**（`favorites/route.ts:283` `void jobTitle;`） | ← 問題3の根本 |

### 経路2（旧マイページ webhook）で作成時にセットされる列

`mypage-response-sync.ts:489-508`

| 列 | 値 |
|--|--|
| `origin` | `"candidate"` |
| `source_type` | **NULL**（legacy 慣例） |
| `external_job_ref` | **NULL**（取得不能） |
| `kyuujin_job_id` | **セットされる**（webhook が渡す kyuujin job id） |
| `file_name` | `求人票_{kyuujin から best-effort 取得した会社名}.pdf`（取れなければ `求人{jobId}`） |
| `drive_file_id` 等 | NULL |
| `response_status` / `response_status_updated_at` / `response_submitted_at` | 回答内容・回答日時 |
| 職種 / 求人タイトル / 求人URL | **すべて無し** |

### サイト経由ブックマークが「持っている／持っていない」情報の総括

| 情報 | 経路1（新サイト） | 経路2（旧webhook） | 復元可能性 |
|--|--|--|--|
| 会社名 | △ `file_name` に埋め込みのみ | △ 同左 | `stripFileMetadata()` で取り出す運用 |
| 求人タイトル | ✕（受信して破棄） | ✕ | **job-platform に再問い合わせすれば取得可能** |
| 職種 | ✕（受信もしていない） | ✕ | job-platform / kyuujin から取得可能 |
| 求人DB（媒体） | △ `external_job_ref` の接頭辞から推定 | ✕ | `resolveBookmarkMedia()` |
| 求人番号 | △ `external_job_ref` 末尾数字（circus 系は取れず null） | ✕ | `extractJobNoFromRef()` |
| 外部求人ID | ○ `external_job_ref` | ○ `kyuujin_job_id` | |
| 求人URL | ○ `memo` 列 | ✕ | |
| AI評価 | ✕（分析を起動しない設計） | ✕ | 要PDF |

### 求人紹介タブに出てこない理由（§3 の必要条件との突合）

経路1の行は `drive_file_id IS NULL` かつ `kyuujin_job_id IS NULL` ＝ **kyuujin 側に job が存在しない**。§3 の必要条件を満たさないので出ない。
経路2の行は `kyuujin_job_id` を持つ＝kyuujin に job がある → **求人紹介タブに出る**。

実データがこの分岐をきれいに裏付けている（全社・`archived_at IS NULL`）:

| 区分 | 件数 |
|--|--|
| `origin='candidate'` 総数（アーカイブ含む） | 229 |
| うち有効（`archived_at IS NULL`） | **202** |
| うち `source_type='job-platform'` かつ `kyuujin_job_id IS NULL`（＝経路1・求人紹介に出ない） | **110**（対象求職者 24名） |
| うち `kyuujin_job_id` あり（＝経路2・求人紹介に出る） | 92（うち `source_type=NULL` 90 / job-platform 2＝後付けバックフィル分） |
| うち `last_exported_at` が立ってしまっている | 10 |

---

## 5. エントリーの求人情報（項目D）

### D-1. `JobEntry` の求人情報系カラム（`prisma/schema.prisma:1729-1862`）

| 意味 | 列 | 型 | 備考 |
|--|--|--|--|
| 会社名 | `company_name` | String NOT NULL | |
| 求人タイトル | `job_title` | String **NOT NULL** | 空文字が入りうる（NULL不可） |
| 職種 | `job_category` | String? | 紹介履歴タブの青バッジ |
| 求人種別 | `job_type` | String? | エントリー管理「求人DB」列の選択式（DODA求人/自社求人/…） |
| 求人DB（媒体） | `job_db` | String? | 紹介時の媒体 |
| エントリー媒体（切替後） | `entry_route` | String? | 切替時のみ |
| 求人番号 | `external_job_no` | String? | 媒体側の求人番号 |
| エントリー求人ID（切替後） | `entry_job_id` | String? | `{ランク}_{番号}_{都道府県}` |
| kyuujin 内部求人ID | `external_job_id` | Int **NOT NULL** | 求人紹介経由=kyuujin `jobs.id`／それ以外 **0** |
| job-platform 求人ID | `external_job_ref` | String? | `route="site-apply"` のみ |
| 求人URL（kyuujin PDF） | `original_url` | String? | |
| 求人DB管理画面URL | `job_db_url` | String? | CAが手入力 |
| 勤務地 / 年収 / 残業 / 転勤 / エリア | `work_location` `salary` `overtime` `transfer` `area_match` `prefecture` | String? | |
| 応募経路 | `route` | String? | `"site-apply"` 等 |

### D-2. 表示元カラム（ファイル:行）

**紹介履歴タブ > エントリー一覧**（`HistoryTab.tsx:3752-3778`）

| 画面 | 参照列 | 位置 |
|--|--|--|
| 会社名 | `entry.companyName` | `:3761` |
| 職種バッジ（青） | **`entry.jobCategory`** | `:3765-3769` |
| 右上の小灰字 | `[entry.jobDb, entry.jobType].filter(Boolean).join(" / ")` | `:3770-3772` |
| 求人タイトル | **`entry.jobTitle`** | `:3776` |

**エントリー管理画面**（`EntryTable.tsx`）

| 画面 | 参照列 | 位置 |
|--|--|--|
| 企業名（上段） | `entry.companyName` | `:967` |
| 求人タイトル（下段・小灰字） | `entry.jobTitle` | `:970` |
| 企業名クリック先 | `route==="site-apply" && externalJobRef` → job-platform 詳細／それ以外 `originalUrl` | `:945-963` |
| 求人DB名（リンク or 点線ボタン） | `entryRoute || jobDb`（＋ `jobDbUrl` があればリンク化） | `:974-1001` |
| 求人種別セレクト | **`entry.jobType`**（選択肢は `getJobTypeOptionsForRoute(entryRoute \|\| jobDb)`） | `:1005-1019` |
| ID行 | `entryRoute ? entryJobId : externalJobNo` | `:1040` |
| **職種（`jobCategory`）はエントリー管理画面には列が存在しない** | — | — |

### D-3. 「求人DB」列にある2つの表示の整理

| | (a) DB名リンク＋求人ID | (b) 選択式「DODA求人/自社求人/パーソル求人…」 |
|--|--|--|
| 保存列 | 表示＝`entry_route ?? job_db`、ID＝`entry_job_id ?? external_job_no`、リンク先＝`job_db_url` | **`job_type`** |
| 意味 | **媒体**（どの求人データベースから来たか） | **求人種別**（その媒体の中での求人の区分） |
| 更新経路 | 🔄ボタン → `EntryRouteSwitchModal`（`entry_route` / `entry_job_id` / `job_db_url` を PATCH）／DB名クリック → URL登録モーダル | セレクト直変更 → `onFieldUpdate(entry.id, { jobType })` |
| 連動しているか | **半連動（一方向）**。(a) が (b) の**選択肢を決める**（`getJobTypeOptionsForRoute(entryRoute ?? jobDb)`。例: `HITO-Link` → `["DODA求人","パーソル求人"]`、`Circus` → `["自社求人","事務局求人","直接求人","share求人"]`）。**値そのものは独立で、(a) を変えても (b) は自動で変わらない・クリアもされない。** そのため媒体切替後に選択肢に無い `job_type` が残留しうる |

（定義: `src/lib/constants/job-types.ts:1-27`、`ENTRY_ROUTE_OPTIONS`/`ROUTE_RANK_MAP` は `:30-54`）

### D-4. エントリー作成経路と、各列に入る値

| 作成経路 | 実装 | 会社名 | 職種 (`job_category`) | 求人タイトル | 求人DB (`job_db`) | 求人番号 / 外部求人ID | 求人URL |
|--|--|--|--|--|--|--|--|
| **① 求人紹介タブ →「選択してエントリー」** | UI `HistoryTab.tsx:3194-3229` / API `api/candidates/[candidateId]/entries/route.ts:76-112` | kyuujin `company_name` | ○ kyuujin `job_category` | ○ kyuujin `job_title` | ブックマークが job-platform 由来なら `resolveJobDbFromBookmark`、無ければ kyuujin `job_db` | `external_job_no` = ブックマーク由来 or kyuujin `job_id` ／ `external_job_id` = **kyuujin jobs.id** | ○ `original_url` |
| **② ブックマーク →「エントリーへ登録」（サイト経由専用）** | UI `HistoryTab.tsx:1571-1596` / API `bookmarks/to-entry/route.ts` | `stripFileMetadata(file_name)` | **✕ セットしない（NULL）** | **✕ 固定 `""`** | `resolveBookmarkMedia(source_media, external_job_ref)` → 無理なら `"HITO-Link"` | `external_job_no` = `extractJobNoFromRef(ref)`（circus 系は **null**）／`external_job_id` = **0** ／`external_job_ref` = ブックマークの ref | **✕ NULL** |
| **③ エントリー管理画面「新規登録」（手動）** | UI `EntryCreateModal.tsx:56-73` / API `api/entries/route.ts:163-183` | 手入力 | **✕ 入力欄が無い（NULL）** | 手入力（空可） | 手入力 | `external_job_no` 手入力／`external_job_id` = **0** | ✕ NULL |
| **④ FileMaker 移行データ（過去分）** | 移行バッチ | ○ | **✕ 全件 NULL** | ○ | ○ | `external_job_id` = 0、`fm_entry_no` あり | ✕ |

実測（全社 28,584件）:

| 区分 | 件数 | `job_category` 空 | `job_title` 空 |
|--|--|--|--|
| FileMaker 由来（`fm_entry_no` 非NULL） | 27,571 | **27,571（100%）** | 0 |
| portal 由来（`fm_entry_no` NULL） | 1,013 | **36** | **34** |
| うち `route='site-apply'` | 36 | 36 | 34 |

→ **portal 由来で職種・タイトルが欠けているのは `route='site-apply'` の36件だけ。** 職種バッジが古い行で出ないのは FileMaker 移行時に職種を持ってこなかったためで、別問題（既存仕様）。

`route='site-apply'` 36件の求人DB内訳: **HITO-Link 29件 / Circus 7件**。

### D-5. 「元々存在しない」のか「存在するのに渡していない」のか

**「存在するのに渡していない」。** 根拠:

- コード: mypage BFF は `favorites` POST に `jobTitle` を含めて送っており、portal は受け取ったうえで `void jobTitle;` と明示的に捨てている（`favorites/route.ts:257, 283`）。＝**送信側は持っている**。
- コード: `to-entry` は `jobTitle: ""` を固定で書き込み、`jobCategory` にはそもそも触れない。**取りに行く実装が無い**だけで、取得不能ではない。
- データ: `external_job_ref`（`hl-ap-314617` 等）が全36件に保存されている。これは job-platform の `source_job_id` で、そこから会社名・職種・タイトル・勤務地・年収を引ける。実際 `EntryTable.tsx:955` はこの ref で job-platform の求人詳細ページを開いている。**同じキーで求人情報も取れる。**
- 運用証跡: 5008248 の site-apply 2件は、作成（23:42 JST）後の 23:51 JST に `job_title` が手で埋められている（`明治機械` 50文字 / `山星屋` 46文字）。`external_job_no` にも `hl-ap-295923` という**接頭辞ごと手入力された値**が入っている。CAが本来システムが運ぶべき情報を手作業で補填している状態。

### D-6. 「エントリー後の引き当て」に相当する処理

**専用の引き当て処理は存在しない。** 近いものは3つあり、いずれも site-apply では機能しない。

| 処理 | 場所 | 引き当てキー | site-apply での挙動 |
|--|--|--|--|
| 求人紹介タブの「エントリー済」判定 | `HistoryTab.tsx:3019, 3180, 3614` `enteredJobIds = entries.map(e => e.externalJobId)` | **`external_job_id`（kyuujin jobs.id）** | site-apply は `external_job_id=0` → **常に不一致**。kyuujin 側にも対応 job が無いので二重には出ないが、「どの求人にエントリーしたか」を突き合わせる術が無い |
| エントリー作成時の重複防止（経路①） | `api/candidates/[candidateId]/entries/route.ts:61-72` | `external_job_id` | 同上（0同士で衝突しうる形だが経路①のみ使用） |
| エントリー作成時の重複防止（経路②） | `bookmarks/to-entry/route.ts:75-81` | **`company_name`（会社名文字列）** | **同一企業の別求人を作れない**（後述） |
| 求人紹介タブ⇄ブックマークの評価・回答クロス参照 | `HistoryTab.tsx:3085-3106` `findBookmarkRating` / `findBookmarkSource` | **会社名の正規化文字列** | 会社名しか無いため、同一企業に複数求人があると取り違える |

**空欄になっている列がキーになっていないか → なっている。** `to-entry` の重複判定が `company_name` である結果、5008248 の「株式会社山星屋」は **ブックマークが2件（`hl-ap-314615` 応募したい／`hl-ap-314617` 気になる）あるのにエントリーは1件（`hl-ap-314617`）しか作られていない**。同一企業の別求人が構造的に登録不能。これは §7.2 の実データで確認済み。

---

## 6. 担当RC表示消失の原因と再現条件（項目E）

### E-1. 担当RC列の表示ロジックと元データ

- 表示: `EntryTable.tsx:931-939`。`splitRecruiterDisplay(entry.candidate.recruiterName)` で「実名（上段）／`(RPA○号機)`・`(一斉配信)`（下段）」の2段表示。空なら `-`。
- ソート/絞り込み用の値: `EntryTable.tsx:283` `formatRecruiterName(entry.candidate.recruiterName)`。
- ヘルパ: `src/lib/recruiterDisplay.ts`（`normalizeRecruiterName:29` / `formatRecruiterName:71` / `splitRecruiterDisplay:94`）。**VIEW専用**でDB保存・集計キーに使ってはならない旨がファイル冒頭に明記されている。
- **元データ: `candidates.recruiter_name`（`prisma/schema.prisma:476`）**。`job_entries` 側には担当RC列は存在せず、常に求職者テーブルからのリレーション取得。

### E-2. エントリー管理画面の更新経路（全列挙）と担当RCの生存

| # | 更新経路 | 呼ぶAPI | レスポンスに `recruiterName` | state の書き換え方 | 担当RCが消えるか |
|--|--|--|--|--|--|
| 1 | エントリーフラグ / 中項目 / 企業側フラグ / 本人側フラグ のセレクト変更 | `PATCH /api/entries/{id}/flags` | **✕ なし**（`flags/route.ts:98-109`） | `setEntries(prev => prev.map(e => e.id===id ? data.entry : e))`（`EntryBoard.tsx:622`）＝**丸ごと差替** | **消える** |
| 2 | 求人種別セレクト（`jobType`）変更 | `PATCH /api/entries/{id}` | **✕ なし**（`[entryId]/route.ts:143-155`） | 丸ごと差替（`EntryBoard.tsx:645`） | **消える** |
| 3 | 面接日時・各種日付・売上/費用・メモ等のインライン編集（`onFieldUpdate` 全般） | 同上 | ✕ なし | 丸ごと差替（`:645`） | **消える** |
| 4 | アーカイブ解除 | `PATCH /api/entries/{id}` | ✕ なし | 丸ごと差替（`:774`） | **消える** |
| 5 | エントリー編集モーダル（`EntryEditModal`）保存 | `PATCH /api/entries/{id}` | ✕ なし | 丸ごと差替（`:1423`） | **消える** |
| 6 | エントリー媒体切替モーダル（`EntryRouteSwitchModal`）保存 | `PATCH /api/entries/{id}` | ✕ なし | 丸ごと差替（`:1436`） | **消える** |
| 7 | 求人DB URL 登録/編集モーダル | `PATCH /api/entries/{id}` | ✕ なし | **部分マージ** `{...e, jobDbUrl: data.entry.jobDbUrl}`（`:949`） | 消えない |
| 8 | 詳細モーダル（`EntryDetailModal`）の一括保存 | `PATCH /api/entries/{id}` | ✕ なし | `onSaved = fetchEntries`（**全件再取得**、`:1357`） | 消えない |
| 9 | 一括フラグ変更（`BulkFlagChangeModal`） | `POST /api/entries/bulk-flags` | — | `fetchEntries()`（`:1379`） | 消えない |
| 10 | 一括選考終了（`BulkEndFlagModal`） / お見送り通知（`EndNoticeModal`） | — | — | `fetchEntries()`（`:1388, 1413`） | 消えない |
| 11 | 一括アーカイブ | `POST /api/entries/bulk-archive` | — | 該当行を `filter` で除去（`:754`） | 消えない |
| 12 | 完全削除（管理者） | `DELETE /api/entries/{id}` | — | `filter` で除去（`:793`） | 消えない |

### E-3. 担当RC以外に同じ理由で消える項目

**無い。** PATCH 2本の `include` は `candidate: { id, name, candidateNumber, employeeId, employee: { name } }` を返す。`EntryTable` が `entry.candidate.*` を読むのは以下6か所のみで、欠けているのは `recruiterName` **だけ**。

| 参照 | 場所 | PATCH レスポンスに含まれるか |
|--|--|--|
| `candidate.name` | `EntryTable.tsx:281, 917` | ○ |
| `candidate.candidateNumber` | `:926` | ○ |
| `candidate.employee?.name`（担当CA） | `:282, 930` | ○ |
| `candidate.recruiterName`（担当RC） | `:283, 933, 935` | **✕** |
| `candidateId`（リンク先） | `:916` | ○（`JobEntry` のスカラ列） |
| `candidate.id` | `EntryBoard` 型定義 | ○ |

`JobEntry` 本体のスカラ列は `prisma.jobEntry.update` が全列返すため欠落しない。

### E-4. 再現条件

- **経路依存**: 上表 #1〜#6 でのみ発生。#7〜#12 では発生しない。CAが「何かを更新すると消える」と感じるのは、日常操作で最も頻度が高いのがフラグ変更・日付入力（#1〜#3）だから。
- **行単位 or 全体**: 差し替えるのは更新した行のみなので、**消えるのはその1行だけ**。ただしフラグ変更は連続操作されるため、複数行が順に「-」になり一覧全体が消えたように見える。
- **リロードで復帰**: `fetchEntries()` が `GET /api/entries`（`recruiterName` を含む）を叩き直すため。DBの値は無傷。
- **追加症状**: 「担当RC」列でソート中に #1〜#6 を行うと、その行だけソートキーが null になり順序が飛ぶ（`EntryTable.tsx:283, 317`）。担当RC絞り込みはサーバ側（`api/entries/route.ts:105-121`）なので行自体は消えない。

（DBを書き換える再現テストは実施していない。以上はコード経路の追跡と、DB値が存在すること（§7.3）の突合により確定。）

---

## 7. 実データ照合結果（項目F）

対象: `candidateNumber='5008248'` / 小林 晶果 / `candidate_id = cmrnc5tcf001r1ds4p6tiw306` / `recruiter_name = "藤本 なつみ"` / 担当CA = 大野 将幸

### F-1/F-2. ブックマークのクロス集計と画面値との対応

`candidate_files WHERE category='BOOKMARK'` は **全52行**。

**有効（`archived_at IS NULL`）= 47行 → 画面「ブックマーク 47」に一致**

| 件数 | origin | drive_file_id | last_exported_at | external_job_ref | kyuujin_job_id | ai_analysis_comment |
|--|--|--|--|--|--|--|
| 41 | NULL(=CA) | あり | あり | あり | **あり** | あり |
| 6 | `candidate` | **なし** | **あり**（誤って立った） | あり | **なし** | なし |

**アーカイブ済（`archived_at IS NOT NULL`）= 5行 → 画面「紹介保留 5」に一致**

| 件数 | origin | drive_file_id | last_exported_at | external_job_ref | kyuujin_job_id |
|--|--|--|--|--|--|
| 5 | NULL(=CA) | あり | **なし** | あり | なし |

紹介保留5件（会社名）: 株式会社ポジティブドリームパーソンズ / 丸正株式会社 / 株式会社清和ビジネス / 国光オブラート株式会社 / 王子ネピア株式会社

**評価内訳ドーナツ 41 = 47 − 6（AI評価対象外）**。除外6件は上表の `origin='candidate'` 6行と完全一致:

| ファイル名 | external_job_ref | 本人回答 |
|--|--|--|
| 求人票_株式会社山星屋.pdf | `hl-ap-314615` | 気になる |
| 求人票_株式会社山星屋.pdf | `hl-ap-314617` | 応募したい |
| 求人票_エルズサポート株式会社.pdf | `circus-ye9ft9` | 気になる |
| 求人票_株式会社ファミリーネット・ジャパン.pdf | `hl-ap-329152` | 気になる |
| 求人票_明治機械株式会社.pdf | `own-rkrmzb` | 応募したい |
| 求人票_パーソルビジネスプロセスデザイン株式会社.pdf | `hl-ap-331324` | 気になる |

**注記**: この6件はすべて `last_exported_at = 2026-08-13 18:38 JST` / `last_exported_to='hito-link'` が立っている。CAが送信モーダルでこの6件を含めて選択して送信した結果、`send-to-job-tool/route.ts:386-402` が PDF送信分と一緒に「出力済」に更新したもの。kyuujin 側には1件も job が作られていない。

### F-3. 求人紹介42件とブックマーク47件の差分（全件・名指し）

kyuujin `project_id=391` が返した `total_jobs=42`。`hidden_job_introductions` は **0件**（非表示による除外なし）。

**差分A: ブックマークにあるが求人紹介に出ない = 6件（すべてサイト経由・`kyuujin_job_id IS NULL`）**

| # | 会社名 | external_job_ref | 理由 |
|--|--|--|--|
| 1 | 株式会社山星屋 | `hl-ap-314615` | PDF実体なし → kyuujin に job 未作成 |
| 2 | 株式会社山星屋 | `hl-ap-314617` | 同上 |
| 3 | エルズサポート株式会社 | `circus-ye9ft9` | 同上 |
| 4 | 株式会社ファミリーネット・ジャパン | `hl-ap-329152` | 同上 |
| 5 | 明治機械株式会社 | `own-rkrmzb` | 同上 |
| 6 | パーソルビジネスプロセスデザイン株式会社 | `hl-ap-331324` | 同上 |

**差分B: 求人紹介に出るがブックマーク（有効）に対応行が無い = 1件**

| kyuujin job.id | 会社名 | 求人タイトル | kyuujin 作成時刻 | 正体 |
|--|--|--|--|--|
| **10858** | 国光オブラート株式会社 | ※未経験OK※★有形商材メーカー老舗企業★【法人営業（既存顧客メイン）】東京／年間休日 | 2026-08-13 21:38:25 JST | **重複求人**。同社は 24秒前の 21:38:01 に job **10857** として既に作られており、ブックマーク（`circus-u9kpq9`）はそちらに紐付いている。10858 は portal 側に対応行を持たない孤立レコード |

**したがって「47と42の差5件」の正体は次のとおり**（単純な5件の欠落ではない）:

```
47 − 6（サイト経由で kyuujin に無い） + 1（kyuujin にだけある重複求人 10858） = 42
```

なお同社は紹介保留にも1行（`求人票_国光オブラート株式会社.pdf` / 2026-07-28 アーカイブ）あるが、これは `last_exported_at` が無く kyuujin にも送られていないため、この計算には関与しない。

### F-4. 5008248 のエントリー13件（全件・列の中身つき）

`job_entries WHERE candidate_id=…` は13件。全件 `is_active=true` / `archived_at=NULL`。

| # | 会社名 | 経路 | route | job_category | job_title | job_type | job_db | external_job_id | external_job_no | external_job_ref | original_url | entry_flag |
|--|--|--|--|--|--|--|--|--|--|--|--|--|
| 1 | 株式会社フジタ医科器械 | ①求人紹介 | NULL | 営業 | あり(34字) | 自社求人 | Circus | 10848 | 346057 | — | あり | エントリー |
| 2 | **明治機械株式会社** | **②サイト経由** | `site-apply` | **NULL** | あり(50字)※後から手入力 | DODA求人 | HITO-Link | **0** | `hl-ap-295923`※手入力 | `own-rkrmzb` | **なし** | エントリー |
| 3 | **株式会社山星屋** | **②サイト経由** | `site-apply` | **NULL** | あり(46字)※後から手入力 | DODA求人 | HITO-Link | **0** | `hl-ap-314617` | `hl-ap-314617` | **なし** | エントリー |
| 4 | 国光オブラート株式会社 | ①求人紹介 | NULL | 営業 | あり(43字) | 自社求人 | Circus | 10857 | 475148 | — | あり | エントリー |
| 5 | 中央化学株式会社 | ①求人紹介 | NULL | 営業 | あり(49字) | DODA求人 | HITO-Link | 9778 | 126153 | — | あり | エントリー |
| 6 | 稲葉ピーナツ株式会社 | ①求人紹介 | NULL | 営業 | あり(50字) | DODA求人 | HITO-Link | 9784 | 265506 | — | あり | エントリー |
| 7 | 昭和企画株式会社 | ①求人紹介 | NULL | 営業 | あり(48字) | DODA求人 | HITO-Link | 9779 | 246115 | — | あり | エントリー |
| 8 | イニシオフーズ株式会社 | ①求人紹介 | NULL | 営業 | あり(50字) | DODA求人 | HITO-Link | 10842 | 320376 | — | あり | エントリー |
| 9 | 株式会社ヒューマニック | ①求人紹介 | NULL | 営業 | あり(49字) | DODA求人 | HITO-Link | 9797 | 300561 | — | あり | エントリー |
| 10 | 株式会社 SL Creations | ①求人紹介 | NULL | 営業 | あり(50字) | DODA求人 | HITO-Link | 10845 | 269094 | — | あり | エントリー |
| 11 | 日豊機工株式会社 | ①求人紹介 | NULL | 事務 | あり(50字) | DODA求人 | HITO-Link | 10844 | 151233 | — | あり | エントリー |
| 12 | 株式会社増田製粉所 | ①求人紹介 | NULL | 営業 | あり(50字) | DODA求人 | HITO-Link | 9783 | 330242 | — | あり（+`job_db_url` あり） | 書類選考 |
| 13 | フレッシュ・フード・サービス株式会社 | ①求人紹介 | NULL | 営業 | あり(50字) | **NULL** | HITO-Link | 9777 | 311386 | — | あり | エントリー |

**空欄になっている列と経路の対応**:

- `job_category`（職種バッジ）が空 = **#2・#3 の2件のみ。両方とも `route='site-apply'`**。
- `original_url`（求人URL）が空 = **#2・#3 の2件のみ**。同じくサイト経由。
- `external_job_id=0`（kyuujin 未紐付） = **#2・#3 の2件のみ**。
- `job_type` が空 = #13 のみ（これは経路①だが kyuujin の `job_type` が空だったケース。別要因）。

**「株式会社山星屋」（#3）の個別説明**

- 出所: 求職者本人が新サイト（`/site/`）でお気に入り追加 → `favorites` POST で `origin='candidate'` の CandidateFile 作成（2026-08-10 00:44 JST、`external_job_ref='hl-ap-314617'`、本人回答=応募したい）。
- エントリー化: CAがブックマークタブで「エントリーへ登録」 → `bookmarks/to-entry`（2026-08-13 23:42 JST）。
- 欠けたもの: `job_title=""`（to-entry が固定で空文字を書く）、`job_category=NULL`（to-entry が触らない）、`original_url=NULL`、`external_job_id=0`。
- その後 23:51 JST に CA が求人タイトルを手入力して補填（`job_title` 46字）。職種は補填手段が無く NULL のまま。
- **追加問題**: 同社のブックマークは2件（`hl-ap-314615` / `hl-ap-314617`）あるが、`to-entry` の重複判定が **会社名文字列**（`to-entry/route.ts:75-81`）のため、**`hl-ap-314615`（本人「気になる」）はエントリー化されず黙って skip された**。同一企業の別求人を登録できない。

**「明治機械株式会社」（#2）の個別説明**

- 出所: 同じく新サイトのお気に入り（2026-07-29 17:07 JST、`external_job_ref='own-rkrmzb'`＝自社求人サイト由来、本人回答=応募したい）。
- エントリー化: `bookmarks/to-entry`（2026-08-13 23:42 JST）。
- 欠けたもの: 山星屋と同じ（タイトル・職種・URL・kyuujin ID）。
- **加えて媒体判定がズレている**: `own-` 接頭辞なので `resolveBookmarkMedia()` は「自社」を返し、`extractJobNoFromRef('own-rkrmzb')` は数字が無いため **null**。つまり作成直後は `job_db='自社'` / `external_job_no=NULL` だったはず。現在の値（`job_db='HITO-Link'` / `entry_route='HITO-Link'` / `entry_job_id='7_hl-ap-295923_20'` / `external_job_no='hl-ap-295923'`）は **CAが媒体切替モーダルと編集モーダルで手作業修正したもの**（`updated_at=23:51 JST`）。`external_job_no` に接頭辞付き文字列がそのまま入っており、他行（数字のみ）と形式が揃っていない。

### F-5. 担当RCの元データ（DB上の有無）

- `candidates.recruiter_name = "藤本 なつみ"`（**DBに値あり**）。
- 13件のエントリーはすべて同一求職者なので、**13件すべてで担当RCは DB上に存在する**。
- したがって、エントリー管理画面で「-」表示になっている状態は **100% 画面側の欠落**であり、DB上の欠損ではない。
- 参考（全社）: `job_entries` 28,584件のうち、`candidate.recruiter_name` が非NULLなのは **26,827件（93.9%）**。残り 1,757件は元々DBに担当RCが無い（＝リロードしても「-」のまま）。

### F-6. 全社レベルの集計

**(a) `origin='candidate'` のブックマーク**

| 指標 | 件数 |
|--|--|
| 総数（アーカイブ含む） | 229 |
| 有効（`archived_at IS NULL`） | **202** |
| うち **求人紹介タブに出ない**（`source_type='job-platform'` かつ `kyuujin_job_id IS NULL`） | **110** |
| うち求人紹介タブに出る（`kyuujin_job_id` あり） | 92 |
| 「出ない110件」の対象求職者数 | **24名** |
| 誤って `last_exported_at` が立っている（＝「出力済」バッジが出ている） | 10 |

**(b) 職種または求人タイトルが空のエントリーと求人DB内訳**

| 母集団 | 件数 | 内訳 |
|--|--|--|
| 全 `job_entries` | 28,584 | — |
| 職種 or タイトルが空 | **27,607** | ほぼ全量が FileMaker 移行分 |
| └ FileMaker 由来（`fm_entry_no` 非NULL） | 27,571 | `job_category` を移行していないため全件空。**既存仕様であり本件とは別問題** |
| └ **portal 由来（`fm_entry_no` NULL）** | **36** | **全件 `route='site-apply'`** |

portal 由来36件の求人DB内訳:

| 求人DB | 件数 |
|--|--|
| HITO-Link | 29 |
| Circus | 7 |

（参考・全体を求人DBで割った内訳: Circus 17,540 / HITO-Link 5,528 / agentbank 2,911 / クラウドエージェント 749 / マイナビJOB 744 / DODA求人 73 / エーナビ 32 / NULL 30 — ただしこれはほぼ FileMaker 移行分の分布であり、今回の不具合の規模を表さない。）

**site-apply 36件の求職者別内訳**

| 求職者番号 | 氏名 | 件数 | タイトル空 |
|--|--|--|--|
| 5008152 | 高田 凌 | 16 | 16 |
| 5007978 | 北島 友香 | 13 | 13 |
| 5004595 | 東 幸汰 | 3 | 3 |
| 5008186 | 森田 倫名 | 2 | 2 |
| 5008248 | 小林 晶果 | 2 | 0（CAが手入力で補填済み） |

---

## 8. ブックマークからのエントリー作成導線の現状と不足（項目G）

### 現状

| 導線 | 対象 | 前提条件 |
|--|--|--|
| **「エントリーへ登録」ボタン**（`HistoryTab.tsx:1714-1721`。`onEntryCreated` で親の `fetchEntries` を呼ぶ） | **サイト経由のみ**。UI 側判定 `isSiteApply = origin==='candidate' && !drive_file_id`（`:1462`）、サーバ側でも `category='BOOKMARK' ∧ origin='candidate' ∧ drive_file_id IS NULL ∧ archived_at IS NULL` で厳格に再チェック（`to-entry/route.ts:47-56`） | 求人出力ツール側の求人レコードは**不要**。外部求人IDも不要 |
| **「求人紹介へ移動」ボタン**（`:1701-1712`） | サイト経由を明示的に除外（`:1474-1479`）。通常PDF行のみ | kyuujin に job があること（無ければ `send-to-job-tool` で新規送信） |
| **求人紹介タブ →「選択してエントリー」**（`:3548-3560`） | 求人紹介タブに出ている行のみ | **kyuujin の job が必須**（`external_job_id` に kyuujin `jobs.id` を入れるため） |

### 「求人出力していないブックマーク」からそのままエントリーを作れるか

| ブックマークの種類 | エントリー作成 | 不足しているもの |
|--|--|--|
| サイト経由（`origin='candidate'` かつ `drive_file_id IS NULL`） | **作れる**（`to-entry`） | ただし **職種・求人タイトル・求人URL・kyuujin求人IDが空のまま**作られる。加えて **同一会社名の2件目は作れない**（重複判定が会社名） |
| 通常のPDFブックマークで未出力（`drive_file_id` あり / `last_exported_at` NULL） | **作れない** | `to-entry` は `drive_file_id IS NULL` を要求するので弾かれる（422）。求人紹介タブにも出ないので「選択してエントリー」も使えない。**唯一の道は「求人紹介へ移動」で kyuujin へ PDF を出力すること**＝出力せずにエントリー化する導線が存在しない |
| 旧マイページ webhook 由来（`origin='candidate'` / `drive_file_id` NULL / `kyuujin_job_id` あり） | 作れる（`to-entry` の条件を満たす） | 同じく職種・タイトルが空。ただし `kyuujin_job_id` を持っているのに `to-entry` は使わず `external_job_id=0` で作る＝**持っている求人IDを捨てている** |

### まとめ（不足の具体）

1. `to-entry` が **job-platform / kyuujin から求人情報を取り直していない**（`external_job_ref` / `kyuujin_job_id` という取得キーは手元にある）。
2. `to-entry` の重複判定が **会社名** であり、同一企業の複数求人を扱えない。`external_job_ref` を使えば解決する。
3. `to-entry` が `kyuujin_job_id` を無視して `external_job_id=0` を書くため、後から求人紹介タブと突き合わせられない。
4. **通常PDFブックマークを「出力せずにエントリー化」する導線が無い**（現状は kyuujin への出力が必須の関門になっている）。

---

## 9. `lastExportedAt` 参照箇所一覧と実現方式の候補（項目H）

### 参照箇所（`src/` 全件・grep 実測）

| # | ファイル:行 | 用途 | 種別 |
|--|--|--|--|
| 1 | `src/lib/dailyReport/jobSearch.ts:27` | 日報「求人検索」グラフの **出力数（分子）**。`選定率 = 出力数 ÷ (BM数+紹介保留数)` | **読み・集計（壊れる）** |
| 2 | `src/lib/dailyReport/metrics.ts:169` | 日報 CA メトリクスの **jobIntroduced（求人紹介数）** | **読み・集計（壊れる）** |
| 3 | `src/lib/performance/weeklyMatrix.ts:115-124` | 週次実績マトリクス **提案ステージ（初回日ベース）** | **読み・集計（壊れる）** |
| 4 | `src/lib/performance/weeklyMatrix.ts:180-187` | 同 **提案（期間集計）**。JobEntry.jobIntroDate と UNION | **読み・集計（壊れる）** |
| 5 | `src/lib/performance/weeklyMatrix.ts:344-352` | 同 **提案の明細（ドリルダウン）** | **読み・集計（壊れる）** |
| 6 | `src/app/api/performance/detail/route.ts:114-163` | 実績表の求人紹介ドリルダウン（Prisma + 生SQL 両方） | **読み・集計（壊れる）** |
| 7 | `src/lib/support-sub-status.ts:43` | supportSubStatus 自動判定：**出力済BMが1件でもあれば「求人紹介」** | 読み・判定（意味が変わる） |
| 8 | `src/app/api/candidates/[candidateId]/dashboard/route.ts:140-147, 201` | 求職者ダッシュボードの **最終求人提案日 / 配信件数 / マイページ反応の母数** | 読み・表示（意味が変わる） |
| 9 | `src/components/candidates/HistoryTab.tsx:1931-1936` | ブックマーク一覧の **「出力済」バッジ** | 読み・表示 |
| 10 | `src/components/candidates/HistoryTab.tsx:1381-1383` | **「未出力を選択」** トグルの対象判定 | 読み・操作 |
| 11 | `src/components/candidates/HistoryTab.tsx:1484-1485` | 「求人紹介へ移動」で restore と新規送信を振り分ける判定 | 読み・分岐 |
| 12 | `src/app/api/candidates/[candidateId]/bookmarks/send-to-job-tool/route.ts:98` | **書き込み**（サイト経由のみの早期リターン経路） | 書き |
| 13 | `src/app/api/candidates/[candidateId]/bookmarks/send-to-job-tool/route.ts:394-401` | **書き込み**（PDF送信分＋同一リクエストのサイト経由行） | 書き |
| 14 | `src/app/api/candidates/[candidateId]/bookmarks/restore-jobs/route.ts:223-228` | **書き込み**（kyuujin から復活させた行） | 書き |
| 15 | `src/app/api/candidates/[candidateId]/bookmarks/restore-jobs/route.ts:94` | 読み（照合対象の取得） | 読み |
| 16 | `src/app/api/external/extraction-complete/route.ts:68-78, 117` | `kyuujin_job_id` 突合の **並び順キー**（最新の出力を優先） | 読み・照合 |
| 17 | `src/app/api/candidates/[candidateId]/files/route.ts:102` | API レスポンスに含める | 読み・受け渡し |
| 18 | `src/app/api/external/bookmarks/from-job-platform/route.ts:70` | **立てない旨のDECISIONコメント**（配信ではないため weeklyMatrix に乗せない） | 設計判断の記録 |
| 19 | `scripts/analyze-funnel-by-rank.ts` / `scripts/backfill-kyuujin-job-id.ts` ほか | 調査スクリプト | 参考 |

### `lastExportedAt` を流用した場合に壊れる集計（具体名）

1. **日報「求人検索」グラフの出力数と選定率**（`jobSearch.ts`）— 分子が水増しされ、選定率が実態より高く出る。
2. **日報 CA メトリクスの「求人紹介数」**（`metrics.ts:169`）。
3. **週次実績マトリクスの「求人紹介（提案）」人数**（`weeklyMatrix.ts` 3か所）— JobEntry.jobIntroDate と UNION されるため、提案人数と提案日が変わる。CA別・期間別に集計されており人事評価用。
4. **実績表の求人紹介ドリルダウン明細**（`performance/detail/route.ts`）— 明細行が増える。
5. **supportSubStatus 自動判定**（`support-sub-status.ts:43`）— 「BM」段階の求職者が一斉に「求人紹介」段階へ繰り上がる。
6. **求職者ダッシュボードの「最終求人提案日」「配信件数」**（`dashboard/route.ts`）— 放置日数などの信号バーにも波及。
7. **ブックマーク一覧の「出力済」バッジ／「未出力を選択」**（`HistoryTab.tsx`）— 出力していない行に出力済バッジが付き、CAが「まだ出していない求人」を選べなくなる。
8. **`extraction-complete` の `kyuujin_job_id` 突合順**（`extraction-complete/route.ts:78`）— 出力していない行が「最新の出力」として先頭に来て、求人IDの誤紐付けを起こしうる。

**なお #7・#8 は既に現実に起きている**（5008248 のサイト経由6件に `last_exported_at` が立っているため）。`send-to-job-tool/route.ts:386-402` の既存挙動そのものが、意図せず `last_exported_at` を「紹介済みフラグ」として流用してしまっている状態。

### 実現方式の候補

#### 案A: `candidate_files.introduced_at` を「紹介日」の正として使い、求人紹介判定を「出力日 または 紹介日」にする（推奨）

**`introduced_at` 列は既に存在する**（`schema.prisma:1476`。コメントに「紹介日時（createdAt=行作成時刻とは意味が異なる）」と明記）。新規カラム追加なしで実現できる。

- 影響ファイル: 「紹介済み」として扱いたい判定箇所のみに `OR introduced_at IS NOT NULL` を足す。
  - `src/lib/support-sub-status.ts:43`
  - `src/app/api/candidates/[candidateId]/dashboard/route.ts:140-147, 201`
  - `src/components/candidates/HistoryTab.tsx`（「紹介済み」表示を新設する場合）
- **集計系（`jobSearch.ts` / `metrics.ts` / `weeklyMatrix.ts` / `performance/detail`）は一切触らない** → 日報・実績表は現状の定義（＝実際に出力した行動量）のまま無傷。
- DB変更: **不要**。
- 既存データへの影響: `introduced_at` の現在の充填状況を先に確認する必要がある（未確認）。既に別用途で埋まっていれば案Bへ。
- 弱点: 「出力していないが紹介した」を集計に載せたくなったとき、集計側の定義変更が別途必要（ただしそれは仕様判断であって事故ではない）。

#### 案B: `candidate_files.introduced_to_jobs_at`（仮）を新設する

- DB変更: `candidate_files` に nullable な timestamp 1列を追加（`migrate diff` → 手書き timestamp → `migrate deploy`。CLAUDE.md の Prisma 手順に従う）。nullable 追加のため master 直 push 可の類型。
- 影響ファイル: 案Aと同じ判定箇所 + 新カラムを書き込む API（`bookmarks/to-entry` や新設の「出力せず紹介へ移動」API）+ `files/route.ts:102` の select 追加 + `HistoryTab.tsx` のバッジ表示。
- 既存データへの影響: 全行 NULL で開始＝挙動不変。必要なら過去分バックフィルを別途。
- 利点: `introduced_at` の既存用途と衝突しない。意味が1対1で明確。
- 欠点: カラムが増える。`introduced_at` との使い分けを 03-portal-spec.md に明記する必要がある。

#### 案C（非推奨）: `last_exported_at` をそのまま流用し、`last_exported_to` に `"introduced-only"` のような区別値を入れて集計側で除外する

- 影響ファイル: **上記の集計8か所すべて**に `AND last_exported_to <> 'introduced-only'` を足して回る必要がある。
- 欠点: 1か所でも漏れると人事評価の数字が静かにズレる。生SQL（`weeklyMatrix.ts` / `performance/detail`）が3か所あり漏れやすい。**採用しないことを推奨**。

#### 併せて直すべき既存バグ（方式に関わらず）

`send-to-job-tool/route.ts:386-402` の `exportedFileIds` に `linkOnlyFiles` を含めている点。**kyuujin に job を作っていない行に「出力済」を立てるのは事実に反する**。ここを外すだけで、日報の出力数の水増し（現状10件）と「出力済なのに求人紹介に出ない」表示矛盾が同時に解消する。

---

## 10. 仕様判断が必要な論点リスト（業務の言葉で）

1. **求職者が自分で応募した求人を、CAの「求人紹介」実績に数えるか。**
   数えるなら日報の紹介数・選定率、実績表の提案人数が増える。数えないなら、求人紹介タブとは別の置き場所（例:「本人応募」タブ）が要る。

2. **求人紹介タブは「CAが紹介した求人の一覧」か、「この求職者に関わる求人の全一覧」か。**
   前者なら本人応募は出さないのが正しい。後者なら出す仕組みを作る必要がある。現状は前者の作りだが、CAの期待は後者に見える。

3. **本人応募の求人について、職種・求人タイトルを自動で取ってくるか。**
   取ってくるなら求人サイト側へ問い合わせる処理が要る（1件あたり数百ミリ秒）。取ってこないなら、CAが手で入れる欄を用意する（現在は編集モーダルで入れられるが職種欄が無い）。

4. **職種の入力欄をエントリー編集画面に追加するか。**
   現在エントリー管理画面には職種を入れる場所が無く、紹介履歴タブのバッジは埋める手段が無い。

5. **同じ会社の別々の求人に、それぞれエントリーを作れるようにするか。**
   現在は本人応募のエントリーで「同じ会社は1件だけ」に制限しており、山星屋のように2求人応募していても1件しか登録できない（残りは黙って捨てられている）。

6. **本人応募のエントリーで、求人番号・媒体をどう決めるか。**
   自社求人サイト経由（`own-`）は求人番号が存在しない。現在CAが手で「hl-ap-295923」のような値を入れて辻褄を合わせており、他の行と形式が揃っていない。空欄のままを許すか、別の表記ルールを決めるか。

7. **求人出力ツールへ出さずに「紹介済み」として扱う運用を認めるか。**
   認める場合、日報の「出力数・選定率」と実績表の「求人紹介人数」にそれを含めるかどうかは**別の判断**として明示的に決める必要がある（含めると過去との比較ができなくなる）。

8. **既に「出力済」の表示が付いてしまっている本人応募10件をどう扱うか。**
   表示だけ直す（データはそのまま）／データも直す（日報の過去の数字が変わる）／放置、の3択。

9. **過去に作られた本人応募エントリー34件の求人タイトル・職種を後から埋めるか。**
   埋めるなら一括バックフィルを実施する（求人サイト側にデータが残っている前提）。

10. **昔の FileMaker から移行したエントリー 27,571件に職種が入っていない件を、今回の範囲に含めるか。**
    含めないなら、紹介履歴タブの職種バッジは「古い案件では出ない」ことを仕様として認める。

---

## 11. 修正の分割案

### 先行して単独リリースできるもの

**修正1: 担当RC表示消失（問題4）— 独立・最小・即出し可**

- 他の3件と技術的な依存関係が一切ない。
- 変更は API 2ファイルの `include` に `recruiterName: true` を1行ずつ足すだけ（`api/entries/[entryId]/route.ts:144-153` と `api/entries/[entryId]/flags/route.ts:99-108`）。DB変更なし・UI変更なし。
- 併せて、将来同じ事故を防ぐため 2本の `include` を `api/entries/route.ts:91-93` と共通定数に切り出すことを推奨。
- **CLAUDE.md のデプロイ規則では「既存ロジック変更」に該当するが、影響が API レスポンスの追加フィールドのみでフェイルセーフなため、staging 確認は軽微で済む想定。**

**修正2: サイト経由行に「出力済」が立つ既存バグ — 独立・小さい**

- `send-to-job-tool/route.ts:394-399` の `exportedFileIds` から `linkOnlyFiles` を外す。
- 「出力済なのに求人紹介に出ない」というCAの最大の混乱要因が消え、日報の水増しも止まる。
- 既存データ10件の後始末は §10-8 の判断待ち（コード修正とは分離可能）。

### まとめて1本にすべきもの

**修正3: サイト経由求人の情報欠落（問題2・3）— 一体で設計する**

以下は互いに依存するため分割しない。

- `favorites` POST で `jobTitle` / 職種を保存できるようにする（`CandidateFile` に列追加 or job-platform 参照）
- `to-entry` で `external_job_ref` をキーに求人情報を引き、`job_title` / `job_category` / `original_url` を埋める
- `to-entry` の重複判定を `company_name` から `external_job_ref` に変更する
- `to-entry` で `kyuujin_job_id` がある場合は `external_job_id` に入れる
- エントリー編集モーダルに職種欄を追加する
- 過去34件のバックフィル

**修正4: タブ件数の見え方（問題1）— 仕様判断待ちのため後回し可**

- 件数自体は「バグではない」ので、緊急度は低い。
- 当面は **UIの説明を足すだけ**でCAの混乱は大幅に減らせる（例: 求人紹介タブのラベルに「求人ツールへ出力済みの求人」と補記、ブックマークタブに「うちサイト経由 N件は求人紹介に出ません」と表示）。これは修正1・2と同時に出せる軽微変更。
- kyuujin 側の重複求人（10858）は kyuujin-pdf-tool 側の課題であり、portal では対処しない。

### 推奨リリース順

```
第1弾（すぐ出せる）: 修正1（担当RC） + 修正2（出力済フラグ） + 修正4の説明文追記
第2弾（仕様確定後）: 修正3（サイト経由の求人情報を運ぶ）
第3弾（判断次第）  : 出力せず紹介済みにする方式（§9 案A or 案B）
```

---

## 12. ナレッジ追記用の構造化アウトプット

> 以下はいずれも**追記案**。既存セクションは書き換えない。

### 12-1. `.claude/03-portal-spec.md` 追記案

```markdown
## 求人紹介タブの成立条件（T-161 で確定）

紹介履歴タブの「求人紹介」は **portal のテーブルを一切見ていない**。
kyuujin-pdf-tool の `GET /api/projects/by-job-seeker-id/{candidateNumber}/jobs` の戻り値そのものである
（`src/app/api/candidates/[candidateId]/jobs/route.ts:46`）。

**出現条件（言い切り）**

> 求人紹介タブに出る ⟺ kyuujin 側に対応 job が存在する
>   ∧ portal `hidden_job_introductions` に当該 `job.id` が無い
>   ∧ `candidates.candidate_number` が非 NULL

- kyuujin に job が作られるのは **PDF実体（`candidate_files.drive_file_id`）を送信して抽出させたときだけ**。
- `last_exported_at`（「出力済」バッジ）は **出現条件ではない**。portal 側の記録に過ぎず、
  これが立っていても kyuujin に job が無ければ求人紹介タブには出ない。
- 紐づけキーは **求職者番号（`candidate_number`）**。ここが NULL の求職者は常に 0件になる。

**4タブの母数（それぞれ別データ源。件数が一致しないのが正常）**

| タブ | 母数 |
|--|--|
| ブックマーク | `candidate_files` category=BOOKMARK ∧ `archived_at IS NULL` |
| 紹介保留 | 同上 ∧ `archived_at IS NOT NULL`（ブックマークと排他） |
| 求人紹介 | kyuujin 側の job 数（portal のブックマークとは無関係） |
| エントリー | `job_entries.candidate_id` のみ（`is_active`/`archived_at` で絞らない） |
| 評価内訳ドーナツ | ブックマーク − { `origin='candidate'` ∧ `drive_file_id` 無 ∧ `ai_analysis_comment` 無 } |

## エントリーの求人情報の入り方（T-161 で確定）

| 作成経路 | 実装 | job_category | job_title | external_job_id | original_url |
|--|--|--|--|--|--|
| 求人紹介タブ → 選択してエントリー | `api/candidates/[candidateId]/entries` POST | kyuujin `job_category` | kyuujin `job_title` | kyuujin `jobs.id` | あり |
| ブックマーク → エントリーへ登録（サイト経由専用） | `api/candidates/[candidateId]/bookmarks/to-entry` | **NULL 固定** | **`""` 固定** | **0** | **NULL** |
| エントリー管理 → 新規登録（手動） | `api/entries` POST | **入力欄なし=NULL** | 手入力 | **0** | NULL |
| FileMaker 移行分 | 移行バッチ | **全件 NULL** | あり | 0 | NULL |

- 紹介履歴タブの職種バッジ＝`job_category`、求人タイトル＝`job_title`（`HistoryTab.tsx:3765, 3776`）。
- エントリー管理画面「求人DB」列は **2つの別物**が並ぶ:
  - DB名リンク＋ID = `entry_route ?? job_db` / `entry_job_id ?? external_job_no` / `job_db_url`
  - セレクト（DODA求人・自社求人 等）= **`job_type`**
  - 前者が後者の**選択肢**を決めるだけで（`getJobTypeOptionsForRoute`）、値は独立。媒体を切り替えても `job_type` は自動クリアされない。
- 「エントリー後の引き当て」の唯一のキーは `external_job_id`（kyuujin jobs.id）。
  `route='site-apply'` は 0 なので**引き当て不能**。
- `to-entry` の重複判定は **会社名文字列**。同一企業の別求人は2件目が黙って skip される。
```

### 12-2. `.claude/02-data-sources.md` 追記案

```markdown
## サイト経由ブックマーク（origin="candidate"）の source of truth と欠落列

`candidate_files.origin='candidate'` は「求職者本人の操作で生まれたブックマーク」。作成経路は2系統。

| 系統 | 作成元 | source_type | external_job_ref | kyuujin_job_id | 求人紹介タブ |
|--|--|--|--|--|--|
| 新サイト `/site/` お気に入り | `api/external/candidate-site/favorites` POST | `"job-platform"` | あり（job-platform `source_job_id`） | **NULL** | **出ない** |
| 旧マイページ回答 webhook | `lib/mypage-response-sync.ts` `ensureBookmarkForMypageResponse` | NULL | NULL | **あり** | 出る |

**source of truth**
- 求人の実体（会社名・職種・タイトル・勤務地・年収）= **bizstudio-job-platform**（`external_job_ref` で引く）
- 本人の回答（気になる/応募したい）= portal `candidate_files.response_status`（T-133 箱A）
- portal は求人情報のミラーを持っていない

**欠落列（新サイト経由）**
- `job_title` … mypage から受信しているが `favorites/route.ts:283` で `void jobTitle;` として破棄
- 職種 … 受信もしていない・保持列も無い
- 会社名 … 専用列なし。`file_name`（`求人票_{会社名}.pdf`）から `stripFileMetadata()` で取り出す
- `drive_file_id` / `kyuujin_job_id` … 常に NULL（PDF実体が無い）
- `ai_match_rating` / `ai_analysis_comment` … 常に NULL（AI分析を起動しない設計）
- `source_media` … 立たない。媒体は `external_job_ref` 接頭辞から `resolveBookmarkMedia()` で推定
  （`hl-ap-`→HITO-Link / `circus-`→Circus / `own-`→自社 / `mynavi_jobshare-`→マイナビJOB）
- 求人番号 … `extractJobNoFromRef()`。`circus-*` と `own-*` は数字が無く **null**

**規模（2026-08-13 本番）**: `origin='candidate'` 有効 202件。うち 110件（求職者24名）は
`kyuujin_job_id` が無く求人紹介タブに構造上出ない。
```

### 12-3. `.claude/14-ui-component-map.md` 追記案

```markdown
## エントリー管理画面（EntryBoard）の更新経路と state 更新の構造

`EntryBoard.tsx` は一覧を `entries` state（`GET /api/entries` の戻り）で保持し、更新後の反映方法が
経路ごとに3種類ある。**この違いが「更新すると列が消える」系の不具合の温床**。

| 反映方法 | 該当経路 | 危険度 |
|--|--|--|
| **丸ごと差替**（`prev.map(e => e.id===id ? data.entry : e)`） | フラグ変更(`:622`) / 各種フィールド更新(`:645`) / アーカイブ解除(`:774`) / EntryEditModal(`:1423`) / EntryRouteSwitchModal(`:1436`) | **高**。PATCH レスポンスの `include` が一覧の `include` より狭いと、その差分が画面から消える |
| 部分マージ（`{...e, 特定列}`） | 求人DB URL 保存(`:949`) | 低 |
| 全件再取得（`fetchEntries()`） | EntryDetailModal / 一括フラグ / 一括選考終了 / お見送り通知 | なし |

**不変条件**: `PATCH /api/entries/[entryId]`・`PATCH /api/entries/[entryId]/flags` の
`include.candidate.select` は、**`GET /api/entries` の `include`（`api/entries/route.ts:91-93`）と
常に同一に保つこと**。片方だけに列を足すと、その列は「更新すると消えてリロードで戻る」挙動になる。

**担当RC列**（T-104。`EntryTable.tsx:931-939`）
- 元データは `candidates.recruiter_name`（`job_entries` 側に列は無い）
- 表示は `splitRecruiterDisplay()` の2段表示、ソート/絞り込みは `formatRecruiterName()`
- 絞り込みはサーバ側（`api/entries/route.ts:105-121`）、ソートはクライアント側（`EntryTable.tsx:283, 317`）
- `recruiterDisplay.ts` の戻り値は **VIEW 専用**。DB保存・集計キーに使わない
```

### 12-4. `.claude/12-pitfalls.md` 追記案

> 既存の最終番号は **40**（`## 40. SQL の AT TIME ZONE …`）。よって新規は 41・42。

```markdown
## 41. 更新APIの `include` が一覧APIより狭いと、更新した行だけ列が消える

**症状**: エントリー管理画面で何かを更新すると、その行の「担当RC」が `-` になる。リロードすると戻る。

**原因**: `GET /api/entries` の `include` は `candidate: { …, recruiterName: true, employee: {…} }` を返すが、
`PATCH /api/entries/[entryId]`（`[entryId]/route.ts:143-155`）と
`PATCH /api/entries/[entryId]/flags`（`flags/route.ts:98-109`）の `include` には `recruiterName` が無い。
`EntryBoard` は更新レスポンスで行を**丸ごと差し替える**（`EntryBoard.tsx:622, 645, 774, 1423, 1436`）ため、
返ってこなかった列が `undefined` になる。DB の値は無傷。

**見分け方**: 「更新直後だけ消える／リロードで戻る」＝ほぼ確実にこのパターン。DB を疑う前に
**一覧APIと更新APIの `include`/`select` を突き合わせる**。

**予防**: リレーション付き一覧を持つ画面では、一覧APIと更新APIの `include` を**共通定数**にする。
共通化できない場合は、クライアント側で丸ごと差替をやめて部分マージにする。

**副作用**: 消えた列でクライアントソートしていると、その行だけソートキーが null になり順序も飛ぶ。

## 42. `last_exported_at` は「紹介済みフラグ」ではない（流用すると人事評価の数字が変わる）

`candidate_files.last_exported_at` は **「CAが求人ツール（kyuujin-pdf-tool）へ実際に出力した」行動量の実測値**で、
以下の集計の**分子そのもの**として使われている。

- `src/lib/dailyReport/jobSearch.ts:27` — 日報「求人検索」の出力数・選定率
- `src/lib/dailyReport/metrics.ts:169` — 日報 CA メトリクスの求人紹介数
- `src/lib/performance/weeklyMatrix.ts:115-124, 180-187, 344-352` — 週次実績の提案ステージ（CA別・人事評価用）
- `src/app/api/performance/detail/route.ts:114-163` — 実績表の求人紹介ドリルダウン
- `src/lib/support-sub-status.ts:43` — supportSubStatus の「求人紹介」自動判定
- `src/app/api/candidates/[candidateId]/dashboard/route.ts:140-147` — 最終求人提案日・配信件数

「出力していないが紹介扱いにしたい」行にこの列を立てると、上記が**過去に遡って水増しされる**。
`last_exported_to` に区別値を入れて集計側で除外する方式は、生SQL が3か所あり漏れやすいので採らないこと。
別列（`introduced_at` の活用 or 新設）で表現し、集計側の定義は触らないのが安全。

**既に踏んでいる実例（T-161）**: `bookmarks/send-to-job-tool/route.ts:394-401` が、PDF送信分と一緒に
サイト経由行（`origin='candidate'` ∧ `drive_file_id IS NULL`）まで「出力済」に更新している。
kyuujin に job は作られないため、**「出力済バッジは付くのに求人紹介タブに出ない」**という表示矛盾と、
日報の出力数の水増し（本番10件）が同時に起きていた。
```

---

## 付録: 調査に使用したクエリ環境

- 接続: `railway ssh --service bizstudio-portal`（`railway run` は不使用）
- 実行: コンテナ `/app` 上の Node v22 + `@prisma/client` v7.3.0 + `@prisma/adapter-pg`
- スクリプトは base64 でコンテナへ転送し、`/app/q*.js` として実行（読み取り専用・`prisma.$disconnect()` で終了）
- 日付表記は `toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })` を使用（`toISOString().slice(0,10)` は不使用）
