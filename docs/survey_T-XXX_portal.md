# T-XXX PDF直登録ブックマーク求人の正しい自動登録（エリア外HITO-Link対応） Phase 1 調査（ポータル側）

調査日: 2026-09-28（JST）／対象: bizstudio-portal master（02a350d 時点）／本番DBは `railway ssh --service bizstudio-portal` で SELECT のみ

## 0. 結論（ポータル担当分の要件判定）

| # | 要件 | 判定 | 根拠（要約） |
|--|--|--|--|
| R1 | 手作業なしで番号が付く（エリア外でも） | **一部** | 登録経路（extract-text → ingestAndLink）は動いていて、鈴木さんの14行は全件アップ後1〜2分で番号が付いた。ただし付いたのは `own-*`（求人プラットフォームが「自社」として新規採番）で、HITO-Link の番号ではない |
| R2 | 媒体が正しい（HITO-Link を自社にしない） | **できていない** | `detectMediaFromFilename` は circus（`No\d{5,7}`）と マイナビ（`^\d{4,6}_`）以外を全部 `own` にする。HITO-Link のダウンロード名 `求人票_{会社名}[_{17桁}].pdf` は判定表に無い。本番の PDF直登録 6,358 行中、`求人票_..._{17桁}.pdf` が 3,124 行（99.3% が本文に `求人ID：hl-ap-`）あり、うち 2,465 行が `own-*` で登録済み |
| R5 | エリア・職種列が埋まる | **できていない** | 返却 JSON から読むのは `sourceJobId/status/deduped` のみ。`jobArea/jobCategory/jobCategoryPath` は受け口が無い（from-job-platform と job-attributes だけ） |
| R6 | 送り直し処理が正常に回る | **できていない** | 2026-08-25 以降ほぼ毎回失敗（直近200回: 成功33／失敗166、9/14 16:08Z の成功を最後に連続失敗）。原因は Railway の HTTP プロキシ上限 300 秒。1回10件を直列で回し、1件 30〜40 秒（失敗時は最長120秒）のため 5 分を超えて `502 upstream error` |
| R7 | エントリー画面の求人DBが HITO-Link になる | **一部** | DB名は `resolveBookmarkMedia(sourceMedia, externalJobRef)`（一覧・to-entry 共通）。`sourceMedia` を保存すれば追加改修なしで HITO-Link 表示になる。現状は sourceMedia が null で `own-` 接頭辞から「自社」 |
| R4 | サイト・プレビューで遜色なく表示 | **番号次第** | サイトは `externalJobRef` を `sourceJobId` に昇格させ（`jpNormalize`）、求人プラットフォームの `/api/public/jobs/batch` で肉付けする。正しい `hl-ap-` 番号が付けば通常取り込み行と同じ DTO で描画される。`introducedAt` が無い行はサイトに出ない（紹介保留のまま） |
| R3・R8 | 重複防止・公開サイト非表示 | 求人プラットフォーム側 | — |

## 1. 鈴木 魁仁（5008630 / `cmu7wu6iv00fj0xqwz2y00k3e`）の本日分

本番DBに残っているのは 19:25〜19:27 JST に入れ直した **14 行**（`求人票_{会社名}.pdf`）。1回目（17桁付き）は物理削除（`DELETE /files/[fileId]` は `candidateFile.delete`）のため痕跡なし。

| ファイル名 | 本文の求人ID | 付いた番号 | 送信(JST) | 判定 |
|--|--|--|--|--|
| 求人票_一般財団法人あんしん財団.pdf | hl-ap-207786 | own-btlz27 | 19:27:13 | 送信済・応答あり・媒体誤り |
| 求人票_岡三証券株式会社.pdf | hl-ap-193456 | own-kn4zdv | 19:27:13 | 同上 |
| 求人票_株式会社住宅あんしん保証.pdf | hl-ap-335512 | own-h4y77q | 19:27:13 | 同上 |
| 求人票_株式会社乃村工藝社.pdf | hl-ap-339090 | own-sctwqw | 19:27:14 | 同上 |
| 求人票_損害保険ジャパン株式会社.pdf | hl-ap-183514 | own-5dlh6t | 19:27:14 | 同上 |
| 求人票_大和ハウス工業株式会社.pdf | hl-ap-121940 | own-95dqyw | 19:27:14 | 同上 |
| 求人票_東急リバブル株式会社.pdf | hl-ap-334726 | own-fv9az5 | 19:27:14 | 同上 |
| 求人票_野村不動産ソリューションズ株式会社.pdf | hl-ap-336651 | own-fcijkr | 19:27:15 | 同上 |
| 求人票_北海道信用保証協会.pdf | **なし**（HITO-Link 形式ではない本文。「業種:/職種:/設立年:」形式） | own-30li7s | 19:27:33 | 送信済・応答あり・媒体は本文から判定不能 |
| 求人票_KDDI Biz Edge株式会社.pdf | hl-ap-274958 | own-h8znd3 | 19:27:16 | 媒体誤り |
| 求人票_ＫＩＳＣＯ株式会社.pdf | hl-ap-228043 | own-wi42ih | 19:27:16 | 媒体誤り |
| 求人票_ＳＢＩマネープラザ株式会社.pdf | hl-ap-339408 | own-cajvws | 19:27:16 | 媒体誤り |
| 求人票_アイリスチトセ株式会社.pdf | hl-ap-338280 | own-4jaxn1 | 19:27:16 | 媒体誤り |
| 求人票_オリックス自動車株式会社.pdf | hl-ap-340414 | own-glfz2j | 19:27:16 | 媒体誤り |

- 全行 `extractedText` あり（2,609〜7,565 字）、`sourceMedia` / `jobArea` / `jobCategory` / `jobCategoryPath` / `introducedAt` は null。
- 「番号なし」に見えたのは画面を見た時点で投入が終わっていなかったため。**未送信／応答なし／失敗は 0 件**、14 件すべて「送信済み・応答あり・媒体誤り（own）」。
- `platformSubmittedAt` は送信後の書き戻し時刻（成功時は `new Date()` で上書き）。

## 2. 送り直し処理（`/api/internal/bookmarks/resubmit-stale` + GitHub Actions 2時間毎）の失敗原因

- 直近の失敗ログ（run 36410342652・2026-09-28 10:32Z）: curl が 5 分 00 秒ちょうどで `HTTP 502 / upstream error`。Railway のエッジプロキシが 300 秒で切っている（Node 側は処理を続けているが結果は返らない）。
- 直近の成功（9/14 16:08Z）: `candidates=20 stale=18 batchCap=10 processed=7 ok=0 ng=7 skipped=3 durationMs=265860`。**10 件直列で 266 秒**＝上限ぎりぎり。ng 7 件はすべて `HTTP 422 Gemini応答のJSONパースに失敗（生タブ）`（T-201 調査で判明済みの求人プラットフォーム側バグ）。
- 失敗の始まり: 2026-08-25 12:41Z に初失敗、9/6・9/13・9/14 に散発的に成功、9/14 21:27Z 以降は連続失敗（80 回超）。
- 構造: 1 回の対象 = 滞留（`externalJobRef null` かつ `platformSubmittedAt` が null または 30 分超）を `createdAt asc` で最大 10 件、**直列**。1 件のタイムアウトは 120 秒。時間の上限なし。
- 同じ行が永久に失敗する（生タブ 422）と 2 時間ごとに再送され続ける（T-201 で月 ¥6,200 の無駄と判明）。今回の窓期間の限定でこれも止まる。

## 3. 番号の無い PDF 直登録ブックマークの全体（アクティブ・抽出済・Drive 実体あり）

| 区分 | 件数 | 求職者数 |
|--|--|--|
| 合計 | **347** | **66** |
| うち作成 2026-05 | 163 | 37 |
| うち作成 2026-06 | 161 | 19 |
| うち作成 2026-07 | 1 | 1 |
| うち作成 2026-08 | 10 | 7 |
| うち作成 2026-09 | 12 | 9 |
| 現行 cron の対象（cutoff 2026-07-04 以降） | 22 | — |
| 直近 3 日以内 | 1（バンネットワーク株式会社_No547543.pdf・9/26） | 1 |
| 一度も送信されていない（platformSubmittedAt null） | 119 | — |
| 未抽出（extractedText null・Drive あり） | 19 | — |

費用見積もり（全 347 件を送り直した場合）: 1 件 ¥0.6（T-131 7月実績）〜 ¥1.33（T-201 実測）→ **¥208〜¥461**。ただし 2026-05〜06 の 324 件は T-131 ローンチ前の遡及分で、Gemini 生タブ 422 で永久失敗する行を含む。

**追加発見**: `own-*` の番号が付いているのに本文に `求人ID：hl-ap-` がある行が **2,423 件／170 名**（最古 2026-03-26）。これは「番号あり」なので滞留には数えられないが、媒体が誤って自社登録されたもの。求人プラットフォーム側が本文の求人IDで既存求人に紐づける（R3）なら Gemini 不要で付け替えられる。ポータル側から送り直す場合は ¥1,450〜¥3,220（¥0.6〜1.33 × 2,423）。**本プロンプトでは送り直さない（報告のみ）。**

## 4. 登録の送受信（実コード）

```
HistoryTab.uploadFiles
  → POST /api/candidates/{id}/files/upload (category=BOOKMARK)   … Drive 保存 + CandidateFile 作成
  → POST /api/candidates/{id}/bookmarks/extract-text {fileIds}   … pdf-parse → extractedText 保存
      → void ingestAndLink({fileId, fileName, pdfBuffer})          … fire-and-forget（src/lib/job-platform-ingest.ts）
          → updateMany(platformSubmittedAt=now where platformSubmittedAt null AND externalJobRef null) … 投入前クレーム
          → submitPdfToJobPlatform: media = detectMediaFromFilename(fileName)
              POST {JOB_PLATFORM_INGEST_URL}/api/internal/ingest-pdf (multipart: file/media/ref, X-Internal-Key)
              返却 { sourceJobId, status, deduped, confidence, durationMs } のうち sourceJobId/status/deduped だけ読む
          → 成功: update(externalJobRef=sourceJobId, platformSubmittedAt=now)  ※sourceMedia/エリア/職種は書かない
```

- `detectMediaFromFilename`（src/lib/job-platform-ingest.ts）: `No\d{5,7}` → circus / `^\d{4,6}_` → mynavi_jobshare / それ以外 → own。
- `SOURCE_MEDIA_TO_JOBDB`（src/lib/constants/source-media.ts）: hito_link→HITO-Link / circus→Circus / bee→Bee / mynavi_jobshare→マイナビJOB。
- DB名の表示元: HistoryTab.tsx 2344 行 `resolveBookmarkMedia(file.sourceMedia, file.externalJobRef)`（sourceMedia 優先 → ref 接頭辞）。DBNO は `externalJobRef` そのまま。エントリー化（to-entry/route.ts 180 行）も同じ関数で jobDb を決める。
- 求人プラットフォーム側の受け口（origin/main cd2dc58 時点・読み取りのみ）: `media` は `media_sources.code` に実在必須、採番は `{media}-{ランダム6桁}`、重複は PDF の sha256（同一媒体内）。返却に `sourceMedia` 等はまだ無い。

### ファイル名パターンの実データ照合（PDF 直登録 6,358 行）

| パターン | 件数 | 本文に hl-ap | own 登録 | 番号なし |
|--|--|--|--|--|
| `求人票_{会社名}_{17桁}.pdf` | 3,124 | 3,101 | 2,465 | 659 |
| `{会社名}_No{5〜7桁}.pdf`（circus） | 2,963 | 0 | 0 | 628 |
| `{4〜6桁}_{会社名}...pdf`（マイナビ） | 120 | 0 | 0 | 9 |
| `{会社名}：{数字}.pdf`（Bee） | 78 | 0 | 54 | 24 |
| `求人票_{会社名}.pdf`（17桁なし） | 48 | 21 | 38 | 10 |
| その他 | 25 | 3 | 15 | 10 |

- 17桁付きファイル名が circus / マイナビの正規表現に誤マッチする件数: **0**。
- `求人票_{会社名}.pdf`（17桁なし）は本文が HITO-Link のものと別媒体のものが混在（21/48）。→ 予備判定は **本文の `求人ID：hl-ap-\d+` を最優先**、次にファイル名 17桁、最後に従来ルール。

## 5. 求職者サイト（/site/）とサイトプレビュー

- ポータル BFF: `GET /api/external/candidate-site/favorites`。出す条件は `introducedAt IS NOT NULL` または `origin="candidate"`（かつ `origin != "auto"`）。
- DTO（`toFavoriteDTO`）: `externalJobRef` があれば `sourceJobId=externalJobRef, sourceType="job-platform"` に昇格。無ければ `sourceType`（PDF）のまま。
- mypage（bizstudio-mypage）: job-platform 行は `hydrateJobPlatform` が `POST {job-platform}/api/public/jobs/batch {sourceJobIds}` で肉付け → `RecommendCard`／求人詳細（全項目）。PDF 行は `RecommendCardPdf`（会社名＋PDF リンク）。肉付けできない ID（求人プラットフォームに無い）は `job:null` で会社名のみのフォールバック表示。
- サイトプレビュー（`SitePreviewButton` → `POST /api/candidates/{id}/site-preview-url`）は同じ BFF を閲覧専用で見るだけ。
- したがって「通常取り込みと遜色ない表示」の条件は (a) 正しい `hl-ap-` 番号が `externalJobRef` に入る (b) 求人プラットフォームにその求人が存在する (c) `introducedAt` がある、の 3 点。

## 6. 評価（analyze-batch）の会社名突合

`extractSearchNames`（src/lib/analyze-bookmarks.ts 210 行）の第1パターン `^求人票[_]?(.+?)(?:_\d{10,})?$` が 10 桁以上の末尾数字を除外する。実データ 3,125 件の 17桁ファイル名で第1候補に日時が残るのは 1 件（`ホワイト500選定_20260609151718708.pdf`・「求人票_」で始まらない例外）。→ **修正不要**。

## 7. 修正方針（Phase 2）

1. **返却値の保存**: `submitPdfToJobPlatform` の返却型に `sourceMedia` / `jobArea` / `jobCategory` / `jobCategoryPath` を追加。`ingestAndLink` と `runResubmitStale` の書き戻しで `sourceMedia`（返却優先、無ければ予備判定）と、3 項目が揃ったときだけエリア・職種を保存（T-200 ルール: 揃わなければ既存値を消さない）。
2. **予備判定** `resolveFallbackMedia({fileName, extractedText})`: 本文 `求人ID：hl-ap-` → hito_link ／ ファイル名 `求人票_..._{17桁}.pdf` → hito_link ／ それ以外は従来の `detectMediaFromFilename`。**送信時の `media` は従来どおりファイル名判定のまま**（旧受け口に `hito_link` を送ると `hito_link-xxxxxx` の番号で日次取り込み用の媒体に混入するため。媒体の確定は求人プラットフォームが本文で行う＝取り決め）。
3. **送り直し処理**: 並列 3・時間の上限 150 秒（新規着手の打ち切り。1 件 120 秒タイムアウトでも 300 秒以内に返る）・1 回 10 件のまま。自動の対象を「作成から `T131_RESUBMIT_WINDOW_DAYS`（既定 3）日以内」に限定。手動スクリプト／API の `days` 指定で広げられる。
4. **会社名切り出し**: 修正不要（§6）。
