# T-XXX 完了報告（ポータル側）: PDF直登録ブックマーク求人の正しい自動登録（エリア外HITO-Link対応）

**日付**: 2026-09-28（JST）
**リポジトリ**: bizstudio-portal master
**調査**: `docs/survey_T-XXX_portal.md`
**求人プラットフォーム側の報告**: bizstudio-job-platform `docs/reports/T-XXX_job-platform.md`（main 0126c34・実装 dc99ad7）
**コミット**: 66e97c1（実装・調査・ナレッジ）／本報告は後続コミット
**Railway**: 本番デプロイ SUCCESS（commitHash 66e97c1 を確認）

---

## 要件 R1〜R8 の最終判定（両側合わせて）

| # | 要件 | 判定 | 根拠 |
|--|--|--|--|
| R1 | 手作業なしで番号が付く（エリア外でも） | **○** | テスト候補者 5999999 に北海道の HITO-Link PDF を本番の実経路（アップロード → extract-text → 自動投入）で入れ、**約2秒**で `hl-ap-207786` が付いた。鈴木さんの14件も送り直しで全件付与 |
| R2 | 媒体が正しい（ファイル名非依存） | **○** | 媒体は求人プラットフォームが本文の `求人ID：hl-ap-…` で決め、返却 `sourceMedia=hito_link` をポータルが保存。DB名列は「HITO-Link」。`求人票_{会社名}.pdf` でも `_{17桁}.pdf` でも同じ結果 |
| R3 | 既存求人に紐づける（重複を作らない） | **○（求人プラットフォーム側）** | 14件中 5件は既存の hl-ap 行に紐づけ（`linked`・Gemini なし）、9件は新規作成後に own 行を閉鎖。北海道信用保証協会は同一PDFの既存 `circus-ijue3h` に紐づけ（`duplicate`） |
| R4 | 求職者サイト・プレビューで遜色なく表示 | **○** | サイトプレビューで PDF 直登録の `hl-ap-207786` と通常取り込みの `hl-ap-338063` を項目単位で比較（下表）。カード・詳細ともに同じ構成 |
| R5 | ブックマーク一覧のエリア・職種列が埋まる | **○** | 返却の3項目を保存。鈴木さん14件すべて「北海道 札幌市」＋職種あり |
| R6 | 送り直し処理が正常に回る | **○** | 原因（Railway 300秒上限で 502）を解消。手動実行（dry_run=true）は HTTP 200・0.9秒で正常終了。定時実行（execute）の結果は §送り直し処理 参照 |
| R7 | エントリー画面の求人DBが HITO-Link | **○** | DB名・エントリー化の jobDb はどちらも `resolveBookmarkMedia(sourceMedia, externalJobRef)`。`sourceMedia=hito_link` が入ったので「HITO-Link」になる（追加改修なし） |
| R8 | 公開求人サイトに出さない | **○（求人プラットフォーム側）** | 受け口は `public_ok` 既定 false。今回作成9行・紐づけ先5行とも false を確認（相手側報告） |

## 鈴木 魁仁（5008630）の本日分（送り直し後・14件）

| ファイル名 | 送り直し前 | 送り直し後 DBNO | DB名 | エリア | 職種 | 経路 |
|--|--|--|--|--|--|--|
| 求人票_一般財団法人あんしん財団.pdf | own-btlz27 | hl-ap-207786 | HITO-Link | 北海道 札幌市 | 営業・企画営業（法人向け） | linked |
| 求人票_岡三証券株式会社.pdf | own-kn4zdv | hl-ap-193456 | HITO-Link | 北海道 札幌市 | 金融営業（法人） | linked |
| 求人票_株式会社住宅あんしん保証.pdf | own-h4y77q | hl-ap-335512 | HITO-Link | 北海道 札幌市 | 営業・企画営業（法人向け） | linked |
| 求人票_株式会社乃村工藝社.pdf | own-sctwqw | hl-ap-339090 | HITO-Link | 北海道 札幌市 | 営業・企画営業（法人向け） | linked |
| 求人票_損害保険ジャパン株式会社.pdf | own-5dlh6t | hl-ap-183514 | HITO-Link | 北海道 札幌市 | 代理店営業・パートナーセールス | linked |
| 求人票_大和ハウス工業株式会社.pdf | own-95dqyw | hl-ap-121940 | HITO-Link | 北海道 札幌市 | 不動産営業 | linked |
| 求人票_東急リバブル株式会社.pdf | own-fv9az5 | hl-ap-334726 | HITO-Link | 北海道 札幌市 | 不動産営業 | linked |
| 求人票_野村不動産ソリューションズ株式会社.pdf | own-fcijkr | hl-ap-336651 | HITO-Link | 北海道 札幌市 | 営業・企画営業（法人向け） | linked |
| 求人票_北海道信用保証協会.pdf | own-30li7s | circus-ijue3h | Circus | 北海道 札幌市 | 金融営業（法人） | duplicate（同一PDFの既存 circus 行。本文に HITO-Link の求人IDなし） |
| 求人票_KDDI Biz Edge株式会社.pdf | own-h8znd3 | hl-ap-274958 | HITO-Link | 北海道 札幌市 | 代理店営業・パートナーセールス | linked |
| 求人票_ＫＩＳＣＯ株式会社.pdf | own-wi42ih | hl-ap-228043 | HITO-Link | 北海道 札幌市 | 営業・企画営業（法人向け） | linked |
| 求人票_ＳＢＩマネープラザ株式会社.pdf | own-cajvws | hl-ap-339408 | HITO-Link | 北海道 札幌市 | 営業・企画営業（個人向け） | linked |
| 求人票_アイリスチトセ株式会社.pdf | own-4jaxn1 | hl-ap-338280 | HITO-Link | 北海道 札幌市 | 営業・企画営業（法人向け） | linked |
| 求人票_オリックス自動車株式会社.pdf | own-glfz2j | hl-ap-340414 | HITO-Link | 北海道 札幌市 | ルートセールス・渉外・外商 | linked |

- 送り直しは `scripts/t131-resubmit-stale.ts --candidate=<鈴木さん> --days=all --batch=20 --execute`（own-* を外してから）。14件 16.3 秒・並列3・ok=14 ng=0。Gemini 呼び出し 0（全件が既存行への紐づけ）。
- 「紹介求人へ移動」はしていない（`introducedAt` は全件 null のまま）。1回目のアップ（17桁付き・削除済み）はポータルに痕跡なし（物理削除）。

## 番号が付かなかった原因（Phase 1 の内訳）

| 区分 | 件数 | 説明 |
|--|--|--|
| 未送信 | 0 | — |
| 送信済み・応答なし | 0 | — |
| 送信済み・失敗 | 0 | — |
| 送信済み・応答あり・媒体誤り（own） | **14** | ファイル名判定で `media=own` を送り、求人プラットフォームが自社求人として新規採番。番号は付いたが `own-*`（アップ後 1〜2 分で全件付与済み。「番号なし」に見えたのは処理前に画面を見たため） |

真因はポータル側の `detectMediaFromFilename`（circus・マイナビ以外は全部 own）と、返却の `sourceMedia` を保存していなかったこと。同じ構造で `own-*` が付いた行は本番に **2,423 件／170 名**（2026-03-26 以降）。

## 送り直し処理

| 項目 | 内容 |
|--|--|
| 失敗原因 | 1回10件を直列（1件 30〜40 秒・失敗時 120 秒）で回し、Railway の HTTP プロキシ上限 **300 秒**を超えて `502 upstream error`。2026-08-25 に初失敗、9/14 21:27Z 以降は連続失敗（直近200回: 成功33／失敗166） |
| 直した内容 | 並列 3・時間の上限 150 秒（新規着手の打ち切り。1件 120 秒タイムアウトでも 300 秒以内に返る）・上限 10 件のまま。`deferred` で持ち越し件数を返す |
| 自動の対象期間 | **作成から 3 日以内**（env `T131_RESUBMIT_WINDOW_DAYS`、API `?days=` で 1〜3650、手動スクリプト `--days=N|all`）。期間外は `outsideWindow` に件数と求職者数だけ返す |
| 手動実行（dry_run=true） | run 36414485830: HTTP 200・859ms・`candidates=1 stale=1 outsideWindow={files:346,candidates:65}` 正常終了 |
| 手動実行（dry_run=false・execute） | run 36415618358: HTTP 200・20.6秒・`processed=1 ok=1 ng=0 deferred=0`。3日窓内の1件（バンネットワーク株式会社_No547543.pdf）が `circus-odl3ee`（滋賀県 彦根市・一般事務・庶務）で紐づき、`outsideWindow={files:346,candidates:65}` は送らず報告のみ。21:00 JST 以降の定時実行は同じ経路で回る |
| 対象0件 | DRY-RUN/EXECUTE とも件数だけ返して正常終了（変更なし） |

## たまっている他の求職者の分（未実行・報告のみ）

| 区分 | 件数 | 求職者数 | 費用見積もり（¥0.6〜1.33/件） |
|--|--|--|--|
| 番号なし（アクティブ・抽出済・Drive あり） | 347 | 66 | ¥208〜¥461 |
| うち 2026-05〜06 作成（T-131 ローンチ前の遡及分） | 324 | — | — |
| うち直近3日以内（自動対象） | 1（バンネットワーク株式会社_No547543.pdf・circus） | 1 | 手動実行（execute）で処理済み → 残 346 件 |
| 未抽出（extractedText なし） | 19 | — | 抽出後に対象化 |
| **own-\* なのに本文が HITO-Link**（番号は付いている） | **2,423** | **170** | 既存 hl-ap 行があれば紐づけ ¥0／無ければ新規作成 ¥1.33。上限 ¥3,220 |

送るなら `scripts/t131-resubmit-stale.ts --days=all --execute`（番号なし分）。own-* の付け替えは own を外してから同スクリプト（求人プラットフォーム側は本文IDで既存行に紐づける）。求人プラットフォーム側の報告にある 20:03 着の3件（own-728ik7 / own-sdffba / own-eqi1na・別の求職者）も同じ扱い。

## 表示の比較（R4）: PDF直登録 hl-ap-207786 vs 通常取り込み hl-ap-338063（サイトプレビュー・大野テスト）

| 項目 | PDF直登録（あんしん財団） | 通常取り込み（スターゼン） |
|--|--|--|
| 一覧カード: バッジ／掲載日／タイトル／会社名／📍勤務地／💰年収・月給／必要な経験／タグ／仕分けボタン／CAに質問／詳しく知る／メモ | すべてあり（NEW・2026/9/28 掲載・北海道札幌市） | すべてあり（2026/8/11 掲載・東京都港区（品川駅）） |
| 詳細: どんな会社？ | あり | あり |
| 詳細: 給与（年収・月給・賞与・固定残業） | あり | あり |
| 詳細: 勤務地・アクセス | 勤務地あり／**最寄り駅・アクセスなし**（住所からの駅推定が0件・求人プラットフォーム側の backfill 仕様） | 勤務地・最寄り駅・アクセスあり |
| 詳細: 休日・勤務時間 | あり | あり |
| 詳細: 仕事内容（雇用形態・職種・内容） | あり | あり |
| 詳細: 応募条件（必須・歓迎） | あり | あり |
| 詳細: 待遇・福利厚生 | あり | あり |
| 詳細: 会社情報（会社名・業種・所在地・従業員数・URL） | あり | あり |
| 応募する／気になる／詳しく知る／担当CAに質問／メモ | あり | あり |
| favorites DTO（ポータル BFF） | `sourceType=job-platform, sourceJobId=hl-ap-207786, companyName=一般財団法人あんしん財団` | 同じ構成。差は `jobUrl`（サイト保存行のみ `/jobs?id=`）と AI 評価（テスト行は未評価） |

差は「最寄り駅（住所次第で 0〜1 件）」と「掲載日が取り込み時刻」のみで、どちらも従来の PDF 由来求人と同じ性質。スクリーンショット: `C:\Users\mnhho\AppData\Local\Temp\claude-chrome-screenshots-dc27bv\screenshot-1790594403181-0.jpg`。

テストの片付け: 紹介マークを戻し（`unmark-introduced` 2件）、テスト行 `cmul5m3fg00050xlmq9suq1i4` はアーカイブ → 完全削除（Drive 実体も削除）。比較用に一時的に紹介マークした `hl-ap-334245` も元（未紹介）に戻した。

## 評価の会社名切り出し

`extractSearchNames` の第1パターンが `(?:_\d{10,})?` で末尾の日時を除外済み。実データ 3,125 件の 17 桁ファイル名で第1候補に日時が残るのは 1 件（`ホワイト500選定_…pdf`・「求人票_」で始まらない例外）。他形式（circus `_No…`／マイナビ `NNNNN_`／Bee `：NNN`）は従来どおり。**修正不要**。

## 戻し用CSV

- ポータル: `docs/reports/T-XXX_suzuki_5008630_backup_before_resubmit.csv`（14行・id / file_name / external_job_ref / source_media / job_area / job_category / job_category_path / introduced_at）
- 求人プラットフォーム: `verify/pdf-bookmark-relink-rollback-202609282007.csv`（相手側報告）

## AI 費用の実績（本プロンプト）

| 項目 | 件数 | 費用 |
|--|--|--|
| 鈴木さん14件の送り直し | 14 | ¥0（全件 linked / duplicate・Gemini なし） |
| テスト候補者の1件 | 1 | ¥0（linked） |
| 送り直し処理の手動実行（dry_run） | 0 | ¥0 |
| 送り直し処理の手動実行（execute・バンネットワーク新規作成） | 1 | ¥1.33 |
| **合計** | | **¥1.33**（求人プラットフォーム側の付け替え新規作成 9件 ≒ ¥13 は相手側計上） |

## コミット／Railway

| 項目 | 内容 |
|--|--|
| 実装コミット | 66e97c1 `fix(bookmarks): T-XXX PDF直登録求人の番号・媒体・エリア職種の反映と送り直し処理の修正` |
| Railway | 本番デプロイ SUCCESS（latestDeployment.meta.commitHash = 66e97c1） |
| 変更ファイル | `src/lib/job-platform-ingest.ts`（返却項目・`resolveFallbackMedia`・`buildLinkData`）／`src/lib/t131-resubmit-stale.ts`（並列・時間上限・期間限定・絞り込み）／`src/app/api/internal/bookmarks/resubmit-stale/route.ts`（`days`/`concurrency`）／`extract-text/route.ts`（本文を渡す）／`scripts/t131-resubmit-stale.ts`／`.claude/02,08,13` |

## 残件・注意

1. own-* 誤登録 2,423 件／170 名の付け替えは未実施（費用は上表）。実施するなら「own を外す → 送り直し」をまとめて行うスクリプト化が必要（今回の鈴木さん分は手順を手動で実行）。
2. 番号なしの滞留 347 件のうち 2026-05〜06 の 324 件は自動対象外のまま（3日窓）。送るなら `--days=all`。Gemini 生タブの JSON パース失敗は相手側で修正済みのため、以前永久失敗していた行も通る見込み。
3. `求人票_{会社名}.pdf` で本文に HITO-Link の求人IDが無いもの（北海道信用保証協会のような別媒体の求人票）は、送信 `media=own` のまま求人プラットフォームのハッシュ／媒体IDで既存行に当たらなければ `own-*` になる（従来どおり）。
