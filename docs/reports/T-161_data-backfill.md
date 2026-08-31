# T-161 Phase 3: 過去データ埋め直し 実施記録

- 実施日: 2026-08-14（JST）
- 実施方法: `railway ssh --service bizstudio-portal` 経由・コンテナ上 Node + Prisma（`railway run` 不使用）
- 前提: T-161 コード修正（master `90eafda`）の Railway デプロイ完了後に実施
- 方針: UPDATE 前に対象行の特定値と現在値を全件控え、復元用SQLを本書に残す。更新は対象列のみ。

---

## 1. 実施サマリ

| 項目 | 対象 | 更新 | 結果 |
|--|--|--|--|
| 5-2 誤出力済フラグのクリア | 9件 | **9件更新** | 対象条件0件化・正常出力済5,800件は前後不変を確認 |
| 5-3 求人情報が空のエントリーの埋め直し | 36件 | **0件**（更新なし） | ブックマーク側に埋め直せる元データが1件も存在しない（下記詳細）。「元データに無い項目は埋めない」原則に従い未更新 |
| 5-4 取りこぼしエントリーの洗い出し | — | —（一覧化のみ・作成なし） | 11件（6名）を列挙 |

対象件数と調査報告書（sagyou-2 `46e0480`）との差異:
- 5-2: 調査時10件 → 実行時9件。調査(8/13)と実行(8/14)の間の状態変化1件。現在条件（`category='BOOKMARK' AND origin='candidate' AND drive_file_id IS NULL AND last_exported_at IS NOT NULL`）に合致する全行=9件を対象とした。大きな食い違いではないと判断し続行。
- 5-3: 36件で一致（うち小林晶果の2件はCAが求人タイトルを手入力済み）。

---

## 2. 5-2: 誤って出力済が立っていたサイト経由行のクリア

### 実行内容

- 条件: `category='BOOKMARK' AND origin='candidate' AND drive_file_id IS NULL AND last_exported_at IS NOT NULL`
- 更新: `last_exported_at = NULL, last_exported_to = NULL`（**この2列のみ**。AI評価・archived・externalJobRef 等は不触）
- 実行前に控えのID集合9件と現在の対象集合の完全一致を機械検証してから updateMany（不一致なら中止する設計だった）

### 実行結果の検証

```
current count 9 / expected 9 / extra [] / missing []   → 一致確認後に更新
UPDATED 9
after mis-stamped count: 0                              → 対象条件が0件になった
normal exported before/after: 5800 → 5800               → 正常な出力済（非サイト行）は不変
```

### 控え（更新前の値・全9件）

全行 `last_exported_to='hito-link'`、`archived_at=NULL`、`kyuujin_job_id=NULL`。

| id | 求職者 | ファイル名 | external_job_ref | last_exported_at (更新前) |
|--|--|--|--|--|
| cms5sy6kp00me0xm9ntzouse5 | 5008248 小林 晶果 | 求人票_明治機械株式会社.pdf | own-rkrmzb | 2026-08-13T09:38:31.303Z |
| cms6537dw02bf0xm9cjlh0olo | 5008248 小林 晶果 | 求人票_エルズサポート株式会社.pdf | circus-ye9ft9 | 2026-08-13T09:38:31.303Z |
| cmslz3g45018a0xlyqympz677 | 5008248 小林 晶果 | 求人票_株式会社山星屋.pdf | hl-ap-314617 | 2026-08-13T09:38:31.303Z |
| cmslz4gsf018j0xlys33jzauo | 5008248 小林 晶果 | 求人票_株式会社山星屋.pdf | hl-ap-314615 | 2026-08-13T09:38:31.303Z |
| cms5sb8v300lr0xm9jgo4mcel | 5008248 小林 晶果 | 求人票_パーソルビジネスプロセスデザイン株式会社.pdf | hl-ap-331324 | 2026-08-13T09:38:31.303Z |
| cms64sy6h02a90xm9ayohmb1q | 5008248 小林 晶果 | 求人票_株式会社ファミリーネット・ジャパン.pdf | hl-ap-329152 | 2026-08-13T09:38:31.303Z |
| cms5q9eoz00fs0xm9ll34u03l | 5008279 配島 真奈美 | 求人票_株式会社オープンハウスグループ.pdf | circus-y5u5fo | 2026-08-12T22:54:06.855Z |
| cms181a2h02s10xobaa9izaas | 5008186 森田 倫名 | 求人票_青山特殊鋼株式会社.pdf | hl-ap-322908 | 2026-07-29T03:04:41.060Z |
| cms17zvja02ru0xobmyl9jlz2 | 5008186 森田 倫名 | 求人票_株式会社アドバンテッジリスクマネジメント.pdf | hl-ap-328330 | 2026-07-29T03:04:41.060Z |

### 復元用SQL（元に戻す場合）

```sql
UPDATE candidate_files SET last_exported_at = '2026-08-13T09:38:31.303Z', last_exported_to = 'hito-link' WHERE id = 'cms5sy6kp00me0xm9ntzouse5';
UPDATE candidate_files SET last_exported_at = '2026-08-13T09:38:31.303Z', last_exported_to = 'hito-link' WHERE id = 'cms6537dw02bf0xm9cjlh0olo';
UPDATE candidate_files SET last_exported_at = '2026-08-13T09:38:31.303Z', last_exported_to = 'hito-link' WHERE id = 'cmslz3g45018a0xlyqympz677';
UPDATE candidate_files SET last_exported_at = '2026-08-13T09:38:31.303Z', last_exported_to = 'hito-link' WHERE id = 'cmslz4gsf018j0xlys33jzauo';
UPDATE candidate_files SET last_exported_at = '2026-08-13T09:38:31.303Z', last_exported_to = 'hito-link' WHERE id = 'cms5sb8v300lr0xm9jgo4mcel';
UPDATE candidate_files SET last_exported_at = '2026-08-13T09:38:31.303Z', last_exported_to = 'hito-link' WHERE id = 'cms64sy6h02a90xm9ayohmb1q';
UPDATE candidate_files SET last_exported_at = '2026-08-12T22:54:06.855Z', last_exported_to = 'hito-link' WHERE id = 'cms5q9eoz00fs0xm9ll34u03l';
UPDATE candidate_files SET last_exported_at = '2026-07-29T03:04:41.060Z', last_exported_to = 'hito-link' WHERE id = 'cms181a2h02s10xobaa9izaas';
UPDATE candidate_files SET last_exported_at = '2026-07-29T03:04:41.060Z', last_exported_to = 'hito-link' WHERE id = 'cms17zvja02ru0xobmyl9jlz2';
```

---

## 3. 5-3: 求人情報が空のエントリーの埋め直し（結果: 更新0件）

### 対象

`route='site-apply'` の JobEntry 36件（fm_entry_no は全件 NULL＝FileMaker 移行分は構造上含まれない）。
求職者別内訳: 高田 凌 16 / 北島 友香 13 / 東 幸汰 3 / 森田 倫名 2 / 小林 晶果 2。

### 埋め直せなかった理由（実測）

埋め直しの元データはブックマーク（`candidate_id` × `external_job_ref` で対応行を特定）だが、実測の結果:

| 埋め直し候補の列 | ブックマーク側の元データ | 実測結果 |
|--|--|--|
| 求人タイトル | `candidate_files.job_title` | **全件 NULL**（この列は T-161 で新設。旧 favorites が受信値を破棄していたため過去分は存在しない） |
| 職種 | `candidate_files.job_category` | **全件 NULL**（同上。過去は受信すらしていない） |
| 求人URL | `candidate_files.memo` | **対応ブックマーク39行すべて memo 空**（多くが T-140 期のバックフィルスクリプト生成行で、memo を持たない） |

→ 「元データに無い項目は埋めない。空のままにする」の原則に従い、**1件も更新していない**。
CAが手入力済みの2件（小林晶果: 明治機械・山星屋の求人タイトル）はもとより不触。

### 今後の埋まり方

- 新規のサイト経由お気に入りは favorites POST が `job_title` / `job_category` / `memo(求人URL)` を保存し、エントリー化（to-entry）で自動引き継ぎされる（T-161 コード修正済み）。
- 既存36件を埋めるには job-platform（Supabase）側から `external_job_ref` で求人情報を取得する別途バックフィルが必要（portal 内には元データが存在しないため本 Phase の範囲外。実施可否は人の判断に委ねる）。
- 当面は エントリー編集モーダルに追加した「職種」欄と既存の求人タイトル欄で人が補える。

---

## 4. 5-4: 重複判定の不備で作られなかった可能性のあるエントリー（一覧のみ・作成していない）

抽出条件: サイト経由ブックマーク（`origin='candidate' AND drive_file_id IS NULL AND external_job_ref IS NOT NULL`）のうち、
同一求職者に **同じ求人（external_job_ref）のエントリーが無く**、かつ **同じ会社名のエントリーが存在する**もの
（＝旧・会社名一致の重複判定なら黙ってスキップされた/される状態の行）。

**注意: この一覧は「エントリー化が試みられて捨てられた」ことの証明ではない**（CAが最初から登録対象にしなかった行も同条件に合致する）。
応募していない求人のエントリーを勝手に作ると選考実態と食い違うため、**作成はせず一覧化のみ**。作成可否は行ごとに人が判断すること。
なお T-161 のコード修正により、今後は同条件でも黙ってスキップされることはない（求人単位判定＋スキップ理由の画面表示）。

| # | 求職者 | 会社名 | external_job_ref | 本人回答 | ブックマーク状態 | CandidateFile.id |
|--|--|--|--|--|--|--|
| 1 | 5008248 小林 晶果 | 株式会社山星屋 | hl-ap-314615 | 気になる | 有効 | cmslz4gsf018j0xlys33jzauo |
| 2 | 5008131 澁川 太郎 | 三菱電機株式会社 | hl-ap-284950 | 応募したい | 有効 | cmreeaiwu00b11dt9fj6nputw |
| 3 | 5008131 澁川 太郎 | 三菱電機株式会社 | hl-ap-197633 | 応募したい | 有効 | cmreehoz700bp1dt9gdcoq18j |
| 4 | 5008131 澁川 太郎 | 三菱電機株式会社 | hl-ap-154763 | 気になる | 有効 | cmrbwfb3x01121do7yv6fe4po |
| 5 | 5008131 澁川 太郎 | 三菱電機株式会社 | hl-ap-197724 | 気になる | 有効 | cmragbtk000rq1dn2y7s16z3f |
| 6 | 5008131 澁川 太郎 | 三菱電機株式会社 | hl-ap-197633 | 気になる | 紹介保留 | cmrb9xyma00201do7bmzv5nen |
| 7 | 5008157 磯村 美穂 | 楽天グループ株式会社 | hl-ap-322028 | 応募したい | 紹介保留 | cmrcmic0u02l51do7so97o6ko |
| 8 | 5008157 磯村 美穂 | プルデンシャル生命保険株式会社 | hl-ap-242270 | 応募したい | 紹介保留 | cmrcmnhvm02lm1do7c9bn1hem |
| 9 | 5007959 奈良 光生 | 株式会社サイバー・バズ | hl-ap-211078 | 応募したい | 有効 | cmshmf0is002s0xpcfjaf3gnd |
| 10 | 5003186 渡邉 勇介 | 松田産業株式会社 | circus-93q64u | 気になる | 有効 | cms96eiby06iv0xm9u69rkzy9 |
| 11 | 5003186 渡邉 勇介 | サンポー食品株式会社 | circus-bttb9k | 気になる | 有効 | cms96fova06j40xm9th5t2qsd |

備考:
- #6 は #3 と同一求人（hl-ap-197633）の重複ブックマーク（有効＋紹介保留の2行）。
- 特に「応募したい」（#2, #3, #7, #8, #9）は本人の応募意思がエントリー台帳から漏れている可能性が高く、優先確認を推奨。

---

## 5. 検証（実施後）

- 5008248 の求人紹介一覧件数（新定義の再現計算）: kyuujin 42 − 重複排除 1（国光オブラート 10858）＋ portal サイト経由 6 = **47件**（変更前: 42件）
- 誤出力済（サイト経由×出力済）: **0件**
- 正常な出力済（非サイト行）: 5,800件（5-2 実行前後で不変）
- introduced_at 保有行 1,742件は全件 last_exported_at も保有 → 実績集計の COALESCE 化で既存の数字は動かない（Phase 1 実装前に実測確認済み）
