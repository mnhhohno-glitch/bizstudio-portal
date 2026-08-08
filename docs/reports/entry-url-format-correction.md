# 求人ページURLの形式判定を台帳基準に訂正（前回の `/pdf/` 一律仮定を撤回）

調査日: 2026-08-08 ／ 対象リポジトリ: bizstudio-portal（worktree `C:\bizstudio\portal-2` / ブランチ `sagyou-2`）／ **調査のみ・実装なし**

守った制約: DB操作は **SELECT のみ**。`railway run` 不使用（`railway ssh --service bizstudio-portal` 経由）。kyuujinPDF への書き込み系API・トークン発行は**一切呼んでいない**（本調査ではトークンを実機確認済み値で受領したため、読み取りGETすら不要だった）。`entry-flag-rules.ts` / `candidate-flags.ts` は読むのみ。

きっかけ: 実機で森田倫名さん（5008186）のアフラック生命保険のカードを開いたところ、URLが
`https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-289264?from=ca-recommend` だった。
前回調査（67c2cb7）の予測 `/site/{token}/pdf/9298` とはパス形式もIDも異なる。

---

## 1. 結論サマリ（3行）

1. **URL形式を決めるのは `CandidateFile.externalJobRef` の有無**（＝台帳側）。`JobEntry` 側の値ではない。portal の配信API `favorites/route.ts:46-52` の `jpNormalize()` が **`externalJobRef` があれば無条件で `sourceType="job-platform"` に昇格**させており、格納済みの `source_type` 列すら判定の主役ではない（`externalJobRef` が null のときだけフォールバックで使われる）。
2. **森田さんの全22件（有効8件＋無効14件）すべてで正しいURLを出せる。形式は22件すべて `/jobs/{externalJobRef}`、`/pdf/` は0件。** アフラックの検算も `…/jobs/hl-ap-289264` で**実機URLと完全一致**した。
3. **前回報告（67c2cb7）の「選考中の90.6%で `/pdf/{id}` を出せる」は撤回。** 正しくは**選考中149件中135件（90.6%）が `/jobs/{ref}` 形式**で、`/pdf/{id}` はわずか**5件（3.4%）**。件数の合計（140件・94.0%）は偶然にも前回と同じだが、**形式の内訳が完全に逆転している**。前回の予測URLをそのまま使うと、**135件が誤ったURLになる**。

---

## 2. 調査項目1: URL形式の決定ロジックを台帳側から特定する

### 2-1. `CandidateFile` の関連列（`prisma/schema.prisma:1403-1473`）

| 列 | 行 | 型 | 意味 |
|---|---|---|---|
| `sourceType` | 1414 | `String?` | `"PDF"` / `"job-platform"`。コメント「既存PDF由来は null（"PDF"相当）」 |
| `externalJobRef` | 1415 | `String?` | **job-platform 求人ID**（`hl-ap-…` / `circus-…` / `own-…` / `mynavi_jobshare-…`） |
| `kyuujinJobId` | 1419 | `Int?` | kyuujinPDF の `jobs.id`（Int） |

```prisma
// 案Z 段階A: job-platform 求人ブックマーク用。既存PDF由来は null（"PDF"相当）。
sourceType        String?               @map("source_type") // "PDF" / "job-platform"
externalJobRef    String?               @map("external_job_ref") // job-platform 求人ID
```

**`source_type` の実値は2種類だけ**（実データ確認）: `NULL`（PDF由来）と `"job-platform"`。文字列 `"PDF"` は1件も存在しない。

### 2-2. 判定ロジック（決定的根拠）

求職者サイトへ台帳行を配信しているのは `src/app/api/external/candidate-site/favorites/route.ts`。同ファイル **L46-52** の `jpNormalize()` が形式を決めている。

```ts
// T-131 step3a: externalJobRef が付いた行（＝job-platformに紐付いた求人。CA/本人が保存したjp求人と、
// PDFアップから自動フルデータ化された紐付け済み求人の両方）を「jp形」に正規化して返す。
//   - sourceJobId = externalJobRef（job-platformの媒体内ID。フル詳細/AI解説の取得キー）
//   - sourceType = "job-platform"（PDF由来でも紐付け済みは job-platform 扱いに昇格）
// これで既存jp行とT-131紐付け行のレスポンス形が一致し、求職者サイト側は区別できず自動でフルカード表示になる。
function jpNormalize(
  externalJobRef: string | null,
  storedSourceType: string | null,
): { sourceJobId: string | null; sourceType: string | null } {
  if (externalJobRef) return { sourceJobId: externalJobRef, sourceType: "job-platform" };
  return { sourceJobId: null, sourceType: storedSourceType };
}
```

適用箇所は L145（`const jp = jpNormalize(f.externalJobRef, f.sourceType);`）で、DTOの `sourceType`（L156）と `sourceJobId`（L149）に反映される。`kyuujinJobId` は**素通し**（L150）。

**→ 判定条件は次のとおり（優先順位つき）:**

| 台帳行の状態 | サイトが受け取る `sourceType` | URL形式 |
|---|---|---|
| `externalJobRef` **あり** | `"job-platform"`（**格納済み `source_type` が NULL でも昇格**） | **`/site/{token}/jobs/{externalJobRef}`** |
| `externalJobRef` なし・`kyuujinJobId` あり | 格納済み `source_type`（実質 NULL＝PDF由来） | **`/site/{token}/pdf/{kyuujinJobId}`** |
| 両方なし | NULL | **リンクなし**（会社名だけの薄いカード） |

**ここが前回の誤りの核心**: 「PDF由来なら `/pdf/`」という素朴な理解は誤りで、**PDFからアップロードされた行でも `externalJobRef` が後付けされていれば `/jobs/` に昇格する**。森田さんのアフラック行がまさにこれで、`file_name` は `求人票_アフラック生命保険株式会社.pdf`（PDF由来）でありながら `external_job_ref = hl-ap-289264` を持つ。

### 2-3. `kyuujinJobId` と `externalJobRef` の同居（重要）

**同居する行は大量に存在し、その場合 `externalJobRef` が優先される。**

`category='BOOKMARK'` の実データ:

| source_type | archived | 行数 | `kyuujin_job_id` あり | `external_job_ref` あり | **両方あり** | 両方なし |
|---|---|---|---|---|---|---|
| （NULL＝PDF由来） | 未アーカイブ | 4,940 | 3,538 | **4,505** | **3,186** | 83 |
| job-platform | 未アーカイブ | 1,809 | 1,579 | 1,809 | 1,579 | 0 |
| （NULL） | アーカイブ済 | 1,064 | 50 | 85 | 45 | 974 |
| job-platform | アーカイブ済 | 234 | 9 | 234 | 9 | 0 |

**→ 未アーカイブ行の「両方あり」は 3,186 + 1,579 = 4,765件。** これらは前回のロジックでは `/pdf/{kyuujinJobId}` と判定されるが、**正しくは `/jobs/{externalJobRef}`**。

さらに深刻なのが1行目: **格納済み `source_type` が NULL（＝一見PDF由来）なのに `external_job_ref` を持つ行が 4,505件**ある。**格納済みの `source_type` 列を読んで判定すると、この4,505件を誤って `/pdf/` 扱いしてしまう。** 判定に使うべきは `source_type` ではなく **`externalJobRef` の有無**。

### 2-4. portal から確認できる範囲の限界

**mypage 側のルーティング実装（`/site/{token}/jobs/{id}` と `/site/{token}/pdf/{id}` のどちらを描画するか）は portal からは読めない。** 本節の判定条件は、

1. portal の配信API（`jpNormalize`）が `sourceType` / `sourceJobId` をどう決めているかというコード上の事実
2. 実機で確認された1件（アフラック → `/jobs/hl-ap-289264`）
3. 森田さん22件すべてがこの規則と矛盾しないこと（3章）

の3点から導いた**強い推定**であり、mypage 側コードによる直接確認ではない。ただし①が「サイト側は区別できず自動でフルカード表示になる」と明記しており、②で実測と一致しているため、実用上は確定と扱ってよい。

---

## 3. 調査項目2・3: 森田さん（5008186）の全エントリーと正しいURL

結合条件（プロンプト指定どおり）:

```sql
LEFT JOIN candidate_files f
  ON f.candidate_id = e.candidate_id AND f.category='BOOKMARK'
 AND ( (e.external_job_id > 0 AND f.kyuujin_job_id = e.external_job_id)
    OR (e.external_job_ref IS NOT NULL AND f.external_job_ref = e.external_job_ref) )
```

トークン: `5008186-rysiyqfo`（実機確認済み・再取得せず）。`?from=` は付けない。

### 3-1. 有効エントリー（`is_active = true`）8件

| # | 会社名 | entry_flag / detail | person_flag | e.external_job_id | e.external_job_ref | 台帳 source_type | 台帳 kyuujin_job_id | 台帳 external_job_ref | archived | response_status | **正しいURL** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **アフラック生命保険株式会社** | 面接 / 適性検査受講中 | 受講完了未確認 | 9298 | — | job-platform | 9298 | **hl-ap-289264** | 否 | INTERESTED | **`https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-289264`** |
| 2 | オリックス自動車株式会社 | 面接 / 適性検査受講中 | 受講完了確認済 | 9299 | — | job-platform | 9299 | hl-ap-308790 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-308790` |
| 3 | リックス株式会社 | 書類選考 / 選考中 | — | 9886 | — | job-platform | 9886 | hl-ap-329133 | 否 | (null) | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-329133` |
| 4 | 日本電技株式会社 | 書類選考 / 選考中 | — | 9890 | — | job-platform | 9890 | hl-ap-128124 | 否 | APPLY | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-128124` |
| 5 | 株式会社もしも | 書類選考 / 選考中 | — | 9892 | — | job-platform | 9892 | hl-ap-303285 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-303285` |
| 6 | 株式会社日本カードネットワーク | 面接 / 一次日程調整中 | 日程回収済 | 9305 | — | job-platform | 9305 | hl-ap-158996 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-158996` |
| 7 | 株式会社アドバンテッジリスクマネジメント | 書類選考 / 選考中 | — | **0** | hl-ap-328330 | job-platform | — | hl-ap-328330 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-328330` |
| 8 | 青山特殊鋼株式会社 | 書類選考 / 選考落ち | **見送り通知未送信** | **0** | hl-ap-322908 | job-platform | — | hl-ap-322908 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-322908` |

台帳行の `file_name` はすべて `求人票_{会社名}.pdf`（PDF由来の名前）だが、#1〜#6 は `external_job_ref` を後付けされているため `/jobs/` 形式になる。

### 3-2. 無効エントリー（`is_active = false`）14件

| # | 会社名 | entry_flag / detail | person_flag | e.external_job_id | 台帳 source_type | 台帳 kyuujin_job_id | 台帳 external_job_ref | archived | response_status | **正しいURL** |
|---|---|---|---|---|---|---|---|---|---|---|
| 9 | 大塚商会 | 書類選考 / 選考落ち | 見送り通知送信済 | 9300 | job-platform | 9300 | **circus-c8ib49** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/circus-c8ib49` |
| 10 | 株式会社カシワバラ・コーポレーション | 書類選考 / 選考落ち | 見送り通知送信済 | 9301 | job-platform | 9301 | hl-ap-301926 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-301926` |
| 11 | 株式会社ザイマックスグループ | 書類選考 / 選考落ち | 見送り通知送信済 | 9313 | job-platform | 9313 | **own-b9y5df** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/own-b9y5df` |
| 12 | 株式会社ユーラスエナジーホールディングス | 書類選考 / 選考落ち | 見送り通知送信済 | 9304 | job-platform | 9304 | hl-ap-312672 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-312672` |
| 13 | 税理士法人レガシィ | 書類選考 / 選考落ち | 見送り通知送信済 | 9306 | job-platform | 9306 | hl-ap-180197 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-180197` |
| 14 | 野村不動産パートナーズ株式会社 | エントリー / クローズ | 見送り通知済み | 9307 | job-platform | 9307 | hl-ap-173890 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-173890` |
| 15 | インターテック・サーティフィケーション株式会社 | エントリー / クローズ | 見送り通知済み | 9308 | job-platform | 9308 | **own-1qvx7x** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/own-1qvx7x` |
| 16 | マンパワーグループ株式会社 | エントリー / クローズ | 見送り通知済み | 9888 | job-platform | 9888 | hl-ap-288469 | 否 | APPLY | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-288469` |
| 17 | リコーリース株式会社 | エントリー / クローズ | 見送り通知済み | 9898 | job-platform | 9898 | hl-ap-297528 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-297528` |
| 18 | 株式会社キャピタル・アセット・プランニング | エントリー / クローズ | 見送り通知済み | 9887 | job-platform | 9887 | **own-0afgiq** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/own-0afgiq` |
| 19 | 株式会社テレビ朝日メディアプレックス | エントリー / クローズ | 見送り通知済み | 9902 | job-platform | 9902 | **own-e83k61** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/own-e83k61` |
| 20 | 株式会社フジキン | エントリー / クローズ | 見送り通知済み | 9903 | job-platform | 9903 | hl-ap-298332 | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-298332` |
| 21 | 株式会社ユーラスエナジーホールディングス | 書類選考 / 選考落ち | 見送り通知送信済 | 9303 | job-platform | 9303 | **own-ws0dzp** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/own-ws0dzp` |
| 22 | 株式会社丹青ディスプレイ | 書類選考 / 選考落ち | 見送り通知送信済 | 9893 | job-platform | 9893 | **own-ibdcal** | 否 | INTERESTED | `https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/own-ibdcal` |

### 3-3. 集計と検算

| 指標 | 件数 |
|---|---|
| 森田さんの全エントリー | **22** |
| 台帳行が存在 | **22（100%）** |
| **`/jobs/{ref}` 形式** | **22（100%）** |
| `/pdf/{kyuujinJobId}` 形式 | **0** |
| URLなし | **0** |
| 台帳行がアーカイブ済み | 0 |

**検算（プロンプト指定）**: アフラック生命保険の行 →
**`https://mypage.bizstudio.co.jp/site/5008186-rysiyqfo/jobs/hl-ap-289264`**
実機URL `…/jobs/hl-ap-289264?from=ca-recommend` から `?from=` を除いたものと**完全一致 ✅**。

**`externalJobRef` の媒体プレフィクスは4種混在**（`hl-ap-` / `circus-` / `own-` / 他）。**`JobEntry.externalJobId` からは絶対に導出できない値**であり、必ず台帳行を引く必要がある。

**注意**: 前回報告（67c2cb7）が予測した `/pdf/9298`（アフラック）は、**パス形式もIDも実際と異なる**。`9298` は kyuujinPDF の内部IDで、サイトのURLには一切現れない。

---

## 4. 調査項目4: 全体への影響の再集計

選考中の有効エントリー（`is_active=true` かつ `entry_flag IN ('エントリー','書類選考','面接','内定')`）について、**未アーカイブの台帳行**で形式を分解した。

| 集計軸 | 件数 | 割合 |
|---|---|---|
| **選考中の有効エントリー総数** | **149** | 100% |
| **うち台帳行あり** | **140** | **94.0%** |
| 　└ **台帳行が `externalJobRef` あり → `/jobs/{ref}` 形式** | **135** | **90.6%** |
| 　└ **台帳行が `externalJobRef` なし・`kyuujinJobId` あり → `/pdf/{id}` 形式** | **5** | **3.4%** |
| 　└ 形式が判定できない（両方なし） | **0** | 0% |
| **台帳行なし（URLなし）** | **9** | **6.0%** |

全有効エントリー（301件）でも同様に分解:

| 集計軸 | 件数 | 割合 |
|---|---|---|
| 有効エントリー総数 | 301 | 100% |
| 台帳行あり | 141 | 46.8% |
| 　└ `/jobs/{ref}` 形式 | **136** | 45.2% |
| 　└ `/pdf/{id}` 形式 | **5** | 1.7% |
| 台帳行なし | 160 | 53.2% |

### 4-1. 前回との比較（形式の内訳が逆転）

| 指標 | 前回（67c2cb7）の主張 | **本調査の実測** |
|---|---|---|
| 選考中でURLを出せる件数 | 140件（94.0%） | 140件（94.0%）**← 合計は一致** |
| うち `/pdf/{id}` | **135件（90.6%）** | **5件（3.4%）** |
| うち `/jobs/{ref}` | **5件（3.4%）** | **135件（90.6%）** |

**合計は偶然一致しているが、内訳は完全に逆転している。** 前回の予測URLをそのまま案内文に使うと、**135件が誤ったURL**になる。

### 4-2. `/pdf/` 形式になる5件の素性

選考中で `/pdf/{kyuujinJobId}` になるのは以下5件のみ。いずれも台帳行の `source_type` が NULL（PDF由来）で `external_job_ref` が未付与＝**T-131 の紐付けバックフィルから漏れた古い行**。

| 会社名 | entry_flag | external_job_id = kyuujin_job_id | file_name |
|---|---|---|---|
| ブラザー工業株式会社 | 書類選考 | 6884 | 求人票_ブラザー工業株式会社.pdf |
| 株式会社 フジキカイ | 書類選考 | 6842 | 求人票_株式会社 フジキカイ.pdf |
| スカパーJSAT株式会社 | 面接 | 3300 | 求人票_スカパーJSAT株式会社.pdf |
| 株式会社ワークポート | 内定 | 5670 | 求人票_株式会社ワークポート.pdf |
| ソーシャルインクルー株式会社 | 内定 | 3391 | 求人票_ソーシャルインクルー株式会社.pdf |

`kyuujin_job_id` の値（3300〜6884）が、`/jobs/` 側の行（9298〜9903）より明確に古い。

### 4-3. 台帳全体（未アーカイブ BOOKMARK 6,749件）の形式分布

| 形式 | 件数 | 割合 |
|---|---|---|
| **`/jobs/{externalJobRef}`** | **6,314** | **93.6%** |
| `/pdf/{kyuujinJobId}` | 352 | 5.2% |
| リンクなし（両方 null） | 83 | 1.2% |

**→ 求人サイト上のカードは 93.6% が `/jobs/` 形式。`/pdf/` はレガシーの少数派。**

### 4-4. 結合の健全性チェック

プロンプト指定の結合条件で多重マッチが起きないかを確認した。

| 1エントリーにマッチした台帳行数 | エントリー数 |
|---|---|
| 0件 | 9 |
| 1件 | 137 |
| **2件** | **3** |

2件マッチの3件（東 幸汰さんのサイト経由応募）は、**同一 `external_job_ref` を持つ重複行（片方アーカイブ済み・片方未アーカイブ）**だった。

| 会社名 | external_job_ref | 台帳行 |
|---|---|---|
| 株式会社サステック | hl-ap-322982 | 2行（アーカイブ済 / 未アーカイブ） |
| 株式会社ニシヤマ | hl-ap-330137 | 2行（アーカイブ済 / 未アーカイブ） |
| 野原グループ株式会社 | hl-ap-324905 | 2行（アーカイブ済 / 未アーカイブ） |

**ref が同一なので生成URLに曖昧性はない。** ただし実装時は `archived_at IS NULL` で1行に絞るのが安全。

---

## 5. 未確認事項

1. **mypage 側のルーティング実装は未確認。** 2-4 のとおり判定条件は portal の `jpNormalize` ＋実機1件＋森田さん22件の整合から導いた推定。mypage リポジトリでの直接確認は残っている。
2. **`?from=ca-recommend` クエリの要否。** 実機URLには付いていたが、本報告では外した形を「正しいURL」としている。**外して開けるかは未検証**。付けた方が安全な可能性がある（サイト側の導線トラッキング用と推測されるが、必須パラメータでないことは未確認）。
3. **台帳行が存在してもカードが表示されない条件。** `response_status='EXCLUDED'` の行や、mypage 側の可視性ルールは portal から確認できない。森田さんの22件は EXCLUDED 0件（INTERESTED 20 / APPLY 2 / null 1）なので本件では影響しないが、全体では別途確認が必要。
4. **アーカイブ済み台帳行しか持たないエントリーの扱い。** 本調査の集計は未アーカイブ行のみを対象にした。アーカイブ済み行はサイトの一覧に出ない（`favorites/route.ts:115` が `archivedAt: null` で絞っている）ため、URLを出しても404相当になる可能性がある。件数は未集計。
5. **`/pdf/{kyuujinJobId}` 形式が現在も生きているか。** 実機で確認したのは `/jobs/` 形式のみ。`/pdf/` 5件のURLが実際に開けるかは未検証。
6. **台帳行なし9件の救済可否**（前回報告 2-3 と同じ）。会社名突合での後付けはカバー率・誤紐付けリスクとも未検証。
7. 集計は 2026-08-08 時点のスナップショット。

---

## 6. 前回報告（67c2cb7）の撤回・修正箇所

| 67c2cb7 の記述 | 判定 | 正しい内容 |
|---|---|---|
| 「台帳に同一 `kyuujin_job_id` の行があれば `/site/{token}/pdf/{externalJobId}` を組み立てられる」（結論サマリ1・2-2） | **撤回** | 台帳行の存在は必要条件だが、**形式は `externalJobRef` の有無で決まる**。`externalJobRef` があれば `/jobs/{externalJobRef}`（＝大多数） |
| 「選考中エントリーの 90.6%（149件中135件）で **`/pdf/{id}`** を出せる」（結論サマリ2） | **撤回** | 90.6%（135件）は **`/jobs/{ref}`**。`/pdf/{id}` は **5件（3.4%）** |
| 「`/jobs/{ref}` 形式の5件を足すと 140件・94.0%」 | **内訳を訂正** | 合計140件・94.0%は正しい。内訳は `/jobs/` 135 ＋ `/pdf/` 5 |
| 5-2 表「オリックス → ✅ `/pdf/9299`」「アフラック → ✅ `/pdf/9298`」ほか計6件 | **すべて誤り・撤回** | 6件とも `/jobs/{ref}`（本報告 3-1 の #1〜#6） |
| 5-3 表「無効14件 → 全件 `/pdf/{id}` 可」 | **形式が誤り** | URLを出せること自体は正しいが、**14件とも `/jobs/{ref}`**（本報告 3-2） |
| 4章「`/site/{token}/pdf/{id}` は 200 を返す＝ルートは存在する」 | **維持（ただし無意味）** | 存在しないIDでも200が返るため元々証拠にならないと明記済み。**森田さんの行に関しては、そもそも `/pdf/` は正しい形式ではなかった** |
| 2-2「`JobEntry.externalJobId` と `CandidateFile.kyuujinJobId` は同一ID空間」 | **維持（正しい）** | ID空間の一致は正しい。ただし**その一致はURL生成には直接使えない**（台帳行を引くためのキーとしてのみ有効） |
| 3章（台帳の突合率）、6章（見送りフラグ）、8章の前々回への修正 | **維持** | 本調査でも同じ結果を再確認した |

**総括**: 67c2cb7 は「台帳行を引く」ところまでは正しかったが、**引いた台帳行の `externalJobRef` を見ずに一律 `/pdf/` を仮定した**点が誤り。本報告の判定条件（2-2）に差し替えること。

---

## 7. 参照ファイル一覧

| ファイル | 行 | 内容 |
|---|---|---|
| `src/app/api/external/candidate-site/favorites/route.ts` | **40-52**, 114-135, 144-164 | **`jpNormalize()`＝URL形式判定の決定的根拠**／台帳配信クエリ（`archivedAt: null` で絞る） |
| `prisma/schema.prisma` | 1403-1473 | `CandidateFile`（`sourceType` 1414 / `externalJobRef` 1415 / `kyuujinJobId` 1419 / 一意制約 1466） |
| `prisma/schema.prisma` | 1729-1862 | `JobEntry`（`externalJobId` 1734 / `externalJobRef` 1767 / `isActive` 1805） |
| `src/lib/openJobPlatformDetail.ts` | 7 | `externalJobRef` の値域（`hl-ap-` / `circus-` / `own-` / `mynavi_jobshare-`） |
| `src/app/api/external/extraction-complete/route.ts` | 105-144 | `kyuujinJobId` の書き込み（ファイル名突合） |
| `src/lib/constants/entry-flag-rules.ts` | 46-52 | `INACTIVE_TRIGGERS`（★変更禁止・読むのみ） |
| `docs/reports/entry-pdf-url-feasibility.md` | — | 前回調査（67c2cb7）。6章で撤回箇所を整理 |
| `docs/reports/entry-message-generator-survey.md` | — | 前々回調査（e77c696） |
