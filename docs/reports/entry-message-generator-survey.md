# エントリー→案内文生成機能の事前調査

調査日: 2026-08-08 ／ 対象リポジトリ: bizstudio-portal（worktree `C:\bizstudio\portal-2` / ブランチ `sagyou-2`）／ **調査のみ・実装なし**

守った制約: DB操作は **SELECT のみ**（UPDATE/INSERT/DELETE なし）。`railway run` 不使用（`railway ssh --service bizstudio-portal` 経由で `pg` クライアントから読み取り）。`src/lib/constants/entry-flag-rules.ts` / `src/constants/candidate-flags.ts` は読むのみ。

作りたい出力の想定形:

```
・アフラック生命保険株式会社　書類選考通過・適性検査受検中
（その求人のページを直接開くURL）
```

---

## 1. 結論サマリ（3行）

1. **求人サイト（bizstudio-job-platform）の求人ページURLを出せるのは、有効エントリー306件中わずか5件（1.6%）**。選考中（エントリー/書類選考/面接/内定）154件に絞っても5件（3.2%）。`externalJobRef` が入るのは `route="site-apply"` の行だけで、通常の求人紹介経由エントリーには構造上まったく入らない。**「その求人のページを直接開くURL」を全社分そろえるのは現状不可能**。代替として求人PDFプレビュー（`originalUrl`）なら選考中154件中147件（95.5%）で出せるが、これは求人サイトのページではない（後述2-3）。
2. **希望の並び順「内定 → 最終面接 → 選考中 → 書類選考中 → エントリー前」は表現できるが、DBの `sort_order` をそのまま使うと壊れる**。親フラグ（`entry_flag`）の `sort_order` 降順は希望どおりだが、子（`entry_flag_detail`）の `sort_order` は「適性検査」「所感」が最終面接より後ろ（12〜16）に**後付けされている**ため降順にすると適性検査が最終面接より上に来る。**コード側で明示的な順位マップを持つ必要がある**。
3. **見送りの「確定」と「本人へ通知済み」は `personFlag` で区別できる**（`見送り通知未送信` = 確定・未通知 / `見送り通知送信済` = 通知済）。ただし**通知済になった瞬間 `is_active=false` に落ちる**（`INACTIVE_TRIGGERS`）ため、**エントリー管理画面の有効行には「見送り通知送信済」が1件も存在しない**（実測0件）。案内文に見送り済みを含めるなら、無効行を明示的に拾いに行く必要がある。

---

## 2. 調査項目1: エントリーと求人サイト掲載求人の紐付き

### 2-1. スキーマ上の該当カラム（`prisma/schema.prisma`）

`JobEntry` モデル（L1729-1862）に「求人を特定するID」は**3種類**あり、指すものが違う。混同すると設計を誤る。

| カラム | 行 | 型 | 指すもの | URL化できるか |
|---|---|---|---|---|
| `externalJobId` | 1734 | `Int` **NOT NULL** | kyuujinPDF 側の求人内部ID | ❌ 単体ではURLにならない |
| `externalJobRef` | 1767 | `String?` | **自社求人サイト(bizstudio-job-platform) の `source_job_id`** | ✅ これが本命 |
| `originalUrl` | 1745 | `String?` | 求人媒体の元URL / Google Drive の求人PDF | △ 求人サイトではない |

`externalJobRef` の定義コメント（schema.prisma:1764-1767）が用途を明記している。

```prisma
// T-140: サイト経由(route="site-apply")のエントリーで、企業名クリックから自社求人サイト
// (bizstudio-job-platform) 詳細ページを開くためのキー(=CandidateFile.externalJobRef を継承)。
// 通常の求人紹介経由エントリーでは null。企業名リンクは originalUrl(kyuujin PDF)側を使う。
externalJobRef  String? @map("external_job_ref")
```

**注意: `externalJobId` は NOT NULL なので「null件数」は常に0**。プロンプトの想定（`externalJobId` の null を数える）はスキーマ上成立しない。実際に欠けているのは `externalJobRef` の方であり、以下はそれを集計している。

### 2-2. 実データ集計（本番DB・SELECT のみ・2026-08-08 時点）

```sql
SELECT count(*)::int AS active_total,
       count(external_job_ref)::int AS with_external_job_ref,
       (count(*) FILTER (WHERE external_job_ref IS NULL))::int AS null_external_job_ref,
       count(original_url)::int AS with_original_url,
       (count(*) FILTER (WHERE external_job_id IS NULL))::int AS null_external_job_id
FROM job_entries WHERE is_active = true;
```

| 指標 | 件数 | 割合 |
|---|---|---|
| 有効なエントリー総数（`is_active = true`） | **306** | 100% |
| うち `externalJobRef` あり（＝求人サイトURLを出せる） | **5** | **1.6%** |
| うち `externalJobRef` が null | **301** | **98.4%** |
| うち `originalUrl` あり | 148 | 48.4% |
| `externalJobId` が null | **0** | 0%（NOT NULL のため） |
| うちアーカイブ済み | 13 | 4.2% |

選考中（`entry_flag IN ('エントリー','書類選考','面接','内定')`＝入社済を除く）に絞ると:

| 指標 | 件数 | 割合 |
|---|---|---|
| 選考中の有効エントリー | **154** | 100% |
| うち `externalJobRef` あり | **5** | **3.2%** |
| うち `originalUrl` あり | **147** | **95.5%** |

### 2-3. null になる原因（コード上の根拠）

**`externalJobRef` に値が入る経路は1本しかない。**

`src/app/api/candidates/[candidateId]/bookmarks/to-entry/route.ts:11-16` のヘッダコメント:

```
// サイト経由レコード（origin="candidate" / driveFileId=null / kyuujin_job_id=null）を、
// 求人紹介タブ（kyuujin 参照）を経由せず JobEntry（エントリー）へ直接登録する。
//   - サイト応募は kyuujin 側に対応 job が無く、構造上「求人紹介」タブには出せない。
// 作成する JobEntry は POST /api/entries の手動作成と同じ形（externalJobId=0・kyuujin/CandidateFile 参照なし）。
// route="site-apply" を印にして、最終形の「求人応募」タブ新設時に WHERE route='site-apply' で分離できるようにする。
```

この経路だけが `CandidateFile.externalJobRef` を `JobEntry.externalJobRef` へ継承する（同ファイル L61, L95）。

対して**通常のエントリー作成 API `src/app/api/entries/route.ts` には `externalJobRef` という文字列が一度も出てこない**（grep 一致0件）。つまり求人紹介経由で作られたエントリーには、そもそも書き込む処理が存在しない。

実データもこれと完全に一致する:

```sql
SELECT coalesce(route,'(null)') AS route, count(*)::int AS n,
       count(external_job_ref)::int AS with_ref, count(original_url)::int AS with_original_url
FROM job_entries WHERE is_active = true GROUP BY 1 ORDER BY 2 DESC;
```

| route | 件数 | `externalJobRef` あり | `originalUrl` あり |
|---|---|---|---|
| （null＝求人紹介経由・手動作成） | 268 | **0** | 148 |
| スカウト | 29 | **0** | 0 |
| **site-apply** | **5** | **5** | 0 |
| 社員紹介 | 1 | 0 | 0 |
| 求職者紹介 | 1 | 0 | 0 |
| 転職フェア | 1 | 0 | 0 |
| 求人応募 | 1 | 0 | 0 |

**`route='site-apply'` の5件＝`externalJobRef` を持つ5件で完全一致**。他経路は例外なく0件。

補強として ID の相関も取った:

| 条件（有効エントリー） | 件数 |
|---|---|
| `external_job_id = 0`（＝kyuujin 参照なしの手動/サイト経由行） | 158 |
| 　└ うち `external_job_ref` あり | **5** |
| `external_job_id > 0` かつ `external_job_ref` あり | **0** |

→ kyuujinPDF 由来のエントリー（`externalJobId > 0`）は**1件も**求人サイトの求人と紐づいていない。

`externalJobRef` の値の形式は全件 `hl-` 始まり（HITO-Link 由来）:

| プレフィクス | 件数 |
|---|---|
| `hl` | 5 |

**結論（項目1）**: null の原因は「求人サイトへ送っていないから」ではなく、**そもそも求人紹介経由のエントリー作成処理が `externalJobRef` を書き込まない設計**だから。求人サイトに掲載されている求人であっても、CAが求人紹介タブ経由でエントリーを作れば紐付きは残らない。98.4%がこれに該当する。

### 2-4. URLの組み立て方（`externalJobRef` がある5件について）

`src/lib/openJobPlatformDetail.ts:10-24`。**静的URLではなく、portal SSO の5分TTLトークンを都度発行して開く**方式。

```ts
const res = await fetch("/api/auth/issue-app-token", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ target_app: "job_platform" }),
});
const { token, target_url } = await res.json();
const url = `${target_url}?auth_token=${encodeURIComponent(token)}&id=${encodeURIComponent(externalJobRef)}`;
window.open(url, "_blank", "noopener,noreferrer");
```

呼び出し元は `src/components/entries/EntryTable.tsx:941-972`（企業名クリック）と `src/components/candidates/HistoryTab.tsx:1050-1058`。

**これは案内文に貼れない。** 5分で失効する CA 用の認証付きURLであり、求職者に送ってもログインできない。求職者へ送るURLが必要なら、job-platform 側の**公開求人詳細URL**（認証なしで開ける形）を別途確認する必要がある — 本調査の範囲（portal 単体）では確認できなかった（→ 4章の未確認事項）。

一方 `originalUrl` は実データを見るとURLの実体が2系統に割れており、これも案内文向きではない:

| `originalUrl` の例 | 性質 |
|---|---|
| `https://circus-job.com/search/352664` | 求人媒体（Circus）の求人ページ。CA向け媒体で求職者に見せる想定ではない |
| `https://drive.google.com/file/d/1.../view` | 求人PDFの Google Drive リンク。`EntryTable.tsx:960` で `/view` → `/preview` に置換して開いている |

---

## 3. 調査項目3: 選考状況の値の実態

### 3-1. 選択肢の定義場所（**2箇所に分裂している**）

`src/app/api/entry-flags/route.ts:10-31` が唯一の供給元で、**親フラグと詳細はDBの `entry_flag_masters` テーブル、本人対応・企業対応は定数ファイル**という二重構造になっている。

```ts
const flags = await prisma.entryFlagMaster.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
const entryFlags = flags.filter((f) => f.flagType === "entry").map((f) => f.value);
const entryDetails: Record<string, string[]> = {};
for (const f of flags.filter((f) => f.flagType === "entry_detail")) { ... }
return NextResponse.json({
  entryFlags, entryDetails,
  personFlags: PERSON_FLAG_RULES,      // ← 定数ファイル（DBではない）
  companyFlags: COMPANY_FLAG_RULES,    // ← 定数ファイル（DBではない）
});
```

| 種別 | 定義元 | 順序の情報 |
|---|---|---|
| `entryFlag`（親） | DB `entry_flag_masters` (flag_type='entry') | `sort_order` あり |
| `entryFlagDetail`（子） | DB `entry_flag_masters` (flag_type='entry_detail', parent_flag=親) | `sort_order` あり |
| `personFlag` | `src/lib/constants/entry-flag-rules.ts` `PERSON_FLAG_RULES` (L1-16) | **なし**（配列順のみ） |
| `companyFlag` | 同 `COMPANY_FLAG_RULES` (L18-36) | **なし**（配列順のみ） |

モデル定義は `prisma/schema.prisma:1933-1943`（`EntryFlagMaster`）。

### 3-2. `entryFlag`（親）の定義と実データ

master（`flag_type='entry'`・全て `is_active=true`）:

| sort_order | value | 有効エントリー実件数 |
|---|---|---|
| 1 | 求人紹介 | 0 |
| 2 | 応募 | 0 |
| 3 | エントリー | 30 |
| 4 | 書類選考 | 63 |
| 5 | 面接 | 47 |
| 6 | 内定 | 14 |
| 7 | 入社済 | 152 |
| — | **合計** | **306** |

**乖離: なし。** 実データの `entry_flag` 値のうち master に存在しないものは**0件**（SQL で `NOT EXISTS` 検証済み）。

`求人紹介` が有効行に0件なのは、`resolveEntryIsActive`（`src/lib/entries/resolveEntryIsActive.ts:33`）が entryFlag=`求人紹介` を無条件で `is_active=false` にするため。

### 3-3. `entryFlagDetail`（子）の定義と実データ

master（`flag_type='entry_detail'`、全て `is_active=true`）と実件数の突き合わせ:

| 親 | sort_order | value | 有効実件数 |
|---|---|---|---|
| エントリー | 1 | 本人辞退 | 0 |
| エントリー | 2 | 追加情報取得中 | 0 |
| エントリー | 3 | BS作成中 | 0 |
| エントリー | 4 | 作成完了送付前 | 0 |
| エントリー | 5 | 送付済本人確認 | 2 |
| エントリー | 6 | 本人確認済提出 | 0 |
| エントリー | 7 | 追加情報依頼前 | 0 |
| エントリー | 8 | 写真取得中 | 0 |
| エントリー | 9 | クローズ | 6 |
| 書類選考 | 1 | **選考中** | **46** |
| 書類選考 | 2 | 本人辞退 | 0 |
| 書類選考 | 3 | 選考落ち | 17 |
| 面接 | 1 | 一次日程調整中 | 17 |
| 面接 | 2 | 一次面接実施前 | 16 |
| 面接 | 3 | 一次面接選考中 | 0 |
| 面接 | 4 | 二次日程調整中 | 0 |
| 面接 | 5 | 二次面接実施前 | 0 |
| 面接 | 6 | 二次面接選考中 | 2 |
| 面接 | 7 | 最終日程調整中 | 0 |
| 面接 | 8 | **最終面接実施前** | **3** |
| 面接 | 9 | **最終面接選考中** | **1** |
| 面接 | 10 | 本人辞退 | 1 |
| 面接 | 11 | 選考落ち | 5 |
| 面接 | 12 | **適性検査受講中** | **2** |
| 面接 | 13 | 適性検査受講済 | 0 |
| 面接 | 14 | 本人所感回収中 | 0 |
| 面接 | 15 | 所感回収済(提出) | 0 |
| 面接 | 16 | 選考中(所感提出) | 0 |
| 内定 | 1 | 検討中 | 2 |
| 内定 | 2 | 承諾 | 10 |
| 内定 | 3 | 本人辞退_他社決 | 0 |
| 内定 | 4 | 本人辞退_自社他 | 1 |
| 内定 | 5 | オファー面談日 | 1 |
| 入社済 | （子なし） | (null) | 152 |

**乖離: あり（2種・計22件）。**

```sql
SELECT e.entry_flag, e.entry_flag_detail, count(*)::int AS n
FROM job_entries e
WHERE e.is_active = true AND e.entry_flag_detail IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM entry_flag_masters m
                  WHERE m.flag_type='entry_detail' AND m.is_active
                    AND m.value = e.entry_flag_detail
                    AND coalesce(m.parent_flag,'') = coalesce(e.entry_flag,''))
GROUP BY 1,2 ORDER BY 3 DESC;
```

| entry_flag | entry_flag_detail | 件数 | 原因 |
|---|---|---|---|
| エントリー | **検討中** | **21** | `schema.prisma:1760` の `entryFlagDetail String? @default("検討中")` が入れた値。master のエントリー配下に「検討中」は**存在しない**（親「求人紹介」と「内定」にはある） |
| エントリー | **（空文字）** | 1 | `EntryDetailModal.tsx:191` で親フラグ変更時に `set("entryFlagDetail", "")` するため、未選択のまま保存されると空文字が残る |

**影響**: UIのドロップダウンは master 由来なので、この21件の「検討中」は**選択肢に無い値が表示されている**（`EntryTable.tsx:1085` は現在値を無条件に `<option>` へ足さないため、セレクトが空表示になる）。案内文生成でこの値を文言マップに通す場合、**必ず「未知の値」フォールバックを用意すること**。

**もう1つの乖離（設計レベル）**: `entry_flag_masters` には `flag_type='person'`（17行）と `flag_type='company'`（13行）のデータも入っているが、**`entry-flags/route.ts` はこれを一切読んでいない**（定数ファイルを返している）。実際 master の person 側には `見送り通知済み` が存在しないのに、`PERSON_FLAG_RULES` にはあり実データにも28件ある。**DBの person/company 行は死にデータ**であり、ここを見て実装すると誤る。

### 3-4. 希望の並び順は表現できるか

希望: **内定 → 最終面接 → 選考中 → 書類選考中 → エントリー前**

| 希望の段階 | 対応する実値 | 存在 |
|---|---|---|
| 内定 | `entryFlag='内定'` | ✅ 14件 |
| 最終面接 | `entryFlag='面接'` かつ `entryFlagDetail IN ('最終日程調整中','最終面接実施前','最終面接選考中')` | ✅ 4件（実施前3・選考中1） |
| 選考中 | `entryFlag='面接'` のその他（一次/二次/適性検査） | ✅ 37件 |
| 書類選考中 | `entryFlag='書類選考'` かつ `entryFlagDetail='選考中'` | ✅ 46件 |
| エントリー前 | `entryFlag='エントリー'` | ✅ 30件 |

**→ 5段階すべて実データで表現できる。**

ただし**`sort_order` をそのまま使うと壊れる**。親は `sort_order DESC` で `内定(6) > 面接(5) > 書類選考(4) > エントリー(3)` となり希望どおりだが、子（面接配下）を `sort_order DESC` で並べると:

```
選考中(所感提出)16 → 所感回収済15 → 本人所感回収中14 → 適性検査受講済13 → 適性検査受講中12
  → 選考落ち11 → 本人辞退10 → 最終面接選考中9 → 最終面接実施前8 → 最終日程調整中7 → ...
```

となり、**適性検査（12）が最終面接（7〜9）より上に来てしまう**。`sort_order` 1〜11 は選考の進行順だが、12〜16（適性検査・所感）は後から追記された枝であり、進行順を表していない。

**→ 表示順はコード側に明示的な順位マップを持たせること。** master の `sort_order` に依存してはいけない。

### 3-5. 「最終面接」「適性検査受検中」「書類選考通過」の有無

| 欲しい文言 | 実値の有無 | 最も近い値 |
|---|---|---|
| **最終面接** | ✅ あり | `最終日程調整中` / `最終面接実施前` / `最終面接選考中`（親=面接）。日付列 `final_interview_date` も併用可（選考中124件のうち13件に入力あり） |
| **適性検査受検中** | △ **表記違いで存在** | master は「適性検査**受講**中」（受検ではなく**受講**）。親=面接・sort_order 12・実データ2件。**案内文で「受検」と書くならコード側で文言変換が必要** |
| **書類選考通過** | ❌ **ステータス値としては存在しない** | 3つの代替がある: ①`documentPassDate`（書類通過日）が入っている＝通過（選考中124件のうち**56件**に入力あり）／②`entryFlag` が `面接` 以降に進んでいる＝通過済みと解釈／③`personFlag='選考通過連絡前'`（本人へ通過連絡する前、の意味。実データ2件） |

なお `aptitudeTestExists`（schema.prisma:1783）は選考中124件で **true が0件**＝実運用で使われていない列。適性検査の判定に使ってはいけない。

参考: 選考中（書類選考/面接/内定・有効）124件の日付列の入力状況

| 列 | 入力あり件数 |
|---|---|
| `document_pass_date` | 56 |
| `first_interview_date` | 40 |
| `final_interview_date` | 13 |
| `second_interview_date` | 5 |
| `aptitude_test_exists = true` | **0** |

---

## 4. 調査項目4: 見送り・通知済みの判定

### 4-1. `INACTIVE_TRIGGERS`（`src/lib/constants/entry-flag-rules.ts:46-52`・**変更禁止・読むのみ**）

```ts
export const INACTIVE_TRIGGERS = {
  // 「入社済」は業務上の成功終着点で、専用タブがある。以前は自動無効化していたが、
  // 「無効も表示」ONにしないと入社済タブに現れない不具合の原因になっていたため、対象から除外した。
  personFlags: ["見送り通知送信済", "見送り通知済み"],
  companyFlags: ["辞退報告済"],
  entryFlagDetails: [] as string[], // 本人辞退は企業対応「辞退報告済」で無効化（companyFlags で判定）。entryFlagDetail だけでは無効化しない。
};
```

適用は同ファイル L68-74 の `applyEntryFlagAutoTransitions`（該当時に `isActive = false`）。

### 4-2. 「見送り確定」と「本人へ通知済み」は区別できるか → **できる**

判定に使うのは **`personFlag` の1列**。`PERSON_FLAG_RULES`（L1-16）が親フラグごとに持つ値:

| 親フラグ | 見送り関連の値 | 意味 |
|---|---|---|
| 書類選考 / 面接 | `見送り通知未送信` | **見送り確定・本人へ未通知** |
| 書類選考 / 面接 | `見送り通知送信済` | **本人へ通知済み** |
| 求人紹介 / エントリー | `見送り通知済み` | 本人へ通知済み（**未通知の値が用意されていない**） |

**→ 書類選考・面接では「確定だが未通知」と「通知済」を明確に区別できる。** 一方 **求人紹介・エントリー段階には「未送信」に相当する選択肢が定義されていない**（`PERSON_FLAG_RULES` L2-3）ので、その2段階では区別できない。

### 4-3. 実データ（**ここが実装上いちばんの落とし穴**）

```sql
SELECT coalesce(entry_flag,'(null)') AS entry_flag, person_flag, is_active, count(*)::int AS n
FROM job_entries WHERE person_flag LIKE '%見送り%' GROUP BY 1,2,3 ORDER BY 4 DESC;
```

| entry_flag | person_flag | is_active | 件数 |
|---|---|---|---|
| 書類選考 | 見送り通知送信済 | **false** | 2,313 |
| 面接 | 見送り通知送信済 | **false** | 499 |
| エントリー | 見送り通知送信済 | **false** | 131 |
| エントリー | 見送り通知済み | **false** | 27 |
| 面接 | 見送り通知未送信 | **false** | 26 |
| 求人紹介 | 見送り通知送信済 | **false** | 20 |
| **書類選考** | **見送り通知未送信** | **true** | **17** |
| 書類選考 | 見送り通知未送信 | false | 17 |
| **面接** | **見送り通知未送信** | **true** | **5** |
| 求人紹介 | 見送り通知未送信 | false | 5 |
| エントリー | 見送り通知未送信 | false | 3 |
| 求人紹介 | 見送り通知済み | false | 1 |
| 内定 | 見送り通知送信済 | false | 1 |

有効行（`is_active=true`）に絞ると:

| person_flag | 件数 |
|---|---|
| 見送り通知未送信 | **22** |
| 見送り通知送信済 | **0** |
| 見送り通知済み | **0** |

**結論**: `INACTIVE_TRIGGERS` の設計上、**本人へ通知した瞬間その行は無効化されエントリー管理画面の通常表示から消える**。したがって——

- 「見送りになったが**まだ本人に伝えていない**会社」＝ 有効行の `personFlag='見送り通知未送信'`（22件）→ **画面上のチェックで拾える**
- 「**すでに本人へ伝えた**見送り会社」＝ `is_active=false` の行 → **通常表示には出ないので、「無効も表示」を有効にするか、案内文生成側で別途 `is_active=false` を読みに行く必要がある**

**案内文に「見送り済み」を含める要件があるなら、対象行の取得条件を `is_active=true` に固定してはいけない。**

---

## 5. 調査項目5: エントリー管理画面の構造

対象: `src/components/entries/EntryBoard.tsx`

### 5-1. 行の選択（チェックボックス）機能 → **既に存在する**

| 内容 | 位置 |
|---|---|
| 選択状態の保持 | `EntryBoard.tsx:276` — `const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());` |
| 選択行の実体化 | `EntryBoard.tsx:1184` — `const selectedEntries = entries.filter((e) => selectedIds.has(e.id));` |
| トグル/全選択/全解除 | `EntryBoard.tsx:1274-1276`（`onSelectToggle` / `onSelectAll` / `onDeselectAll` を `EntryTable` へ渡す） |
| チェックボックス描画 | `EntryTable.tsx:1098` / `1107` / `1117`（ヘッダ全選択＋各行）。列幅は `CHECKBOX_COL_WIDTH = 36`（`EntryTable.tsx:101`） |

`selectedIds` は **ID の Set** のみを持ち、行データは `entries` から都度 filter して得る形。**新規ボタンは `selectedEntries: Entry[]` をそのまま受け取れる。**

### 5-2. ボタンの設置箇所（推奨）

一括アクションバーは **`EntryBoard.tsx:1183-1252`**（`selectedIds.size > 0` のときだけ表示）。既存ボタンは7つ:

| ボタン | 行 |
|---|---|
| 一括フラグ変更 | 1190-1195 |
| 📝 選考終了案内 | 1196-1203（`isSameCandidate` で同一求職者に限定） |
| 🚫 選考終了（フラグのみ） | 1204-1210 |
| 📋 タスク作成 | 1211-1216 |
| **📋 面接案内コピー** | **1217-1223** |
| 🗑 アーカイブ | 1224-1229 |
| 社名をコピー | 1230-1243 |

**推奨設置位置: `EntryBoard.tsx:1223`（「📋 面接案内コピー」の直後）**。理由は下記のとおり、この機能が今回作りたいものとほぼ同型だから。

モーダルのマウント位置は **`EntryBoard.tsx:1379-1387`**（`showInterviewGuideCopy` の隣に `showXxx` を1つ足す）。state 宣言は **`EntryBoard.tsx:284`** の並び。

### 5-3. 流用すべき既存実装

**`src/components/entries/InterviewGuideCopyModal.tsx` が今回の機能の直接の雛形**。「選択行 → 1行1社のテキストを組み立て → クリップボードへコピー」という構造が完全に一致する。

- Props は `{ selectedEntries: Entry[]; onClose: () => void }` のみ（L10-13）
- 行の組み立ては `formatLine()`（L57-69）で `${companyName}｜${m}/${day}(${weekday}) ${hhmm}~｜${tool}` を生成
- **日付規約が守られている**: L17-20 `jstYmd()` が `toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })` を使用。ヘッダに「罠 #17: 日付・曜日・時刻はクライアント JST 基準。toISOString は禁止」と明記（L4）

**注意**: 同じ規約が `EntryTable.tsx:109-117` の `fmtDate` / `fmtDateFull` では**守られていない**（`toISOString().slice(0,10)` を使用）。新規実装では `InterviewGuideCopyModal` 側の作法に従うこと。

### 5-4. 必要なデータは `Entry` 型に揃っているか → **揃っている**

`EntryBoard.tsx:19-98` の `export type Entry` に、案内文生成に必要な項目がすべて存在する。API追加は不要。

| 用途 | フィールド | 行 |
|---|---|---|
| 会社名 | `companyName` | 23 |
| 親ステータス | `entryFlag` | 35 |
| 詳細ステータス | `entryFlagDetail` | 36 |
| 見送り通知判定 | `personFlag` | 38 |
| 書類通過判定 | `documentPassDate` | 47 |
| 最終面接判定 | `finalInterviewDate` | 58 |
| 求人サイトURL用キー | `externalJobRef` | 97 |
| 代替URL | `originalUrl` | 26 |
| 経路 | `route` | 94 |

---

## 6. 森田さんの実データ一覧

### 6-1. 「森田」を含む求職者（6名・氏名の正確な表記）

```sql
SELECT candidate_number, name, name_kana, support_status, support_sub_status
FROM candidates WHERE name LIKE '%森田%' ORDER BY candidate_number;
```

| 求職者番号 | 氏名（正確な表記） | カナ | supportStatus | supportSubStatus | 有効エントリー |
|---|---|---|---|---|---|
| 5001234 | **森田 成美** | モリタ ナルミ | BEFORE | 面談前 | 0件 |
| 5001894 | **森田 道幹** | モリタ ミチマサ | BEFORE | 面談前 | 0件 |
| 5002705 | **森田 麻中** | モリタ マナカ | BEFORE | 面談前 | 0件 |
| 5004220 | **森田 水萌** | モリタ ミホ | BEFORE | 面談前 | 0件 |
| 5008048 | **森田 良** | モリタ リョウ | ENDED | 当社判断 | 0件 |
| **5008186** | **森田 倫名** | **モリタ リンナ** | **ACTIVE** | **面接** | **8件** |

**該当は 5008186「森田 倫名（モリタ リンナ）」1名**。氏名は姓と名の間に**半角スペース1つ**。プロンプト例の「アフラック生命保険株式会社」がこの方のエントリーに実在することでも一致を確認した。

### 6-2. 森田 倫名（5008186）の有効エントリー 8件

| # | 会社名 | entryFlag | entryFlagDetail | personFlag | companyFlag | route | externalJobRef | URL可否 |
|---|---|---|---|---|---|---|---|---|
| 1 | オリックス自動車株式会社 | 面接 | 適性検査受講中 | 受講完了確認済 | 受講完了報告前 | (null) | **null** | ❌ 求人サイト不可（PDFのみ） |
| 2 | **アフラック生命保険株式会社** | **面接** | **適性検査受講中** | 受講完了未確認 | 受講完了報告前 | (null) | **null** | ❌ 求人サイト不可（PDFのみ） |
| 3 | 日本電技株式会社 | 書類選考 | 選考中 | (null) | (null) | (null) | **null** | ❌ 求人サイト不可（PDFのみ） |
| 4 | 株式会社もしも | 書類選考 | 選考中 | (null) | (null) | (null) | **null** | ❌ 求人サイト不可（PDFのみ） |
| 5 | 株式会社日本カードネットワーク | 面接 | 一次日程調整中 | 日程回収済 | 希望日提出済 | (null) | **null** | ❌ 求人サイト不可（PDFのみ） |
| 6 | リックス株式会社 | 書類選考 | 選考中 | (null) | (null) | (null) | **null** | ❌ 求人サイト不可（PDFのみ） |
| 7 | 株式会社アドバンテッジリスクマネジメント | 書類選考 | 選考中 | (null) | (null) | **site-apply** | **hl-ap-328330** | ✅ 可（ただしSSO要・5分TTL） |
| 8 | 青山特殊鋼株式会社 | 書類選考 | 選考落ち | **見送り通知未送信** | (null) | **site-apply** | **hl-ap-322908** | ✅ 可（ただしSSO要・5分TTL） |

`status` は8件すべて `有効`、`archivedAt` は8件すべて null、`jobDb` は8件すべて `HITO-Link`。1〜6は `externalJobId` が実IDあり・`originalUrl` あり、7〜8は `externalJobId=0`・`originalUrl` なし。

**→ 8件中 URLを出せるのは2件（25%）**。全体平均（1.6%）より高いのは、この方がサイト経由応募を2件持っているため。

### 6-3. 日付列（案内文の「書類選考通過」判定材料）

| 会社名 | documentSubmitDate | **documentPassDate** | aptitudeTestExists | firstInterviewDate |
|---|---|---|---|---|
| オリックス自動車株式会社 | 2026-07-22 | **2026-07-30** | false | null |
| **アフラック生命保険株式会社** | 2026-07-22 | **2026-08-02** | **false** | null |
| 日本電技株式会社 | 2026-07-30 | null | false | null |
| 株式会社もしも | 2026-07-30 | null | false | null |
| 株式会社日本カードネットワーク | — | — | false | （調整中） |
| リックス株式会社 | 2026-07-30 | null | false | null |

**プロンプトの例文「アフラック生命保険株式会社　書類選考通過・適性検査受検中」は、実データ上こう再現される:**

- 「書類選考通過」← `documentPassDate = 2026-08-02` が入っている（かつ `entryFlag` が `書類選考` から `面接` へ進んでいる）
- 「適性検査受検中」← `entryFlagDetail = '適性検査受講中'`（**DBは「受講」・案内文は「受検」＝表記変換が必要**）
- 「（その求人のページを直接開くURL）」← `externalJobRef = null` のため **この行はURLを出せない**

### 6-4. 参考: 無効エントリー 14件（見送り通知済みで画面から消えている行）

すべて 5008186（森田 倫名）。`externalJobRef` は14件とも null。

| person_flag | 件数 | 会社例 |
|---|---|---|
| 見送り通知送信済（書類選考・選考落ち） | 6 | 大塚商会 / 株式会社ザイマックスグループ / 株式会社カシワバラ・コーポレーション / 税理士法人レガシィ / 株式会社ユーラスエナジーホールディングス（2件） / 株式会社丹青ディスプレイ |
| 見送り通知済み（エントリー・クローズ） | 8 | 野村不動産パートナーズ株式会社 / 株式会社テレビ朝日メディアプレックス / マンパワーグループ株式会社 / インターテック・サーティフィケーション株式会社 / 株式会社キャピタル・アセット・プランニング / リコーリース株式会社 / 株式会社フジキン |

**この14件が「本人へ通知済みの見送り会社」**。4-3 のとおり有効行には出てこないため、案内文に含めるなら別途取得が必要。

---

## 7. 実装時の懸念点

| # | 懸念 | 深刻度 | 内容と対策 |
|---|---|---|---|
| 1 | **URLがほぼ出せない**（98.4%が `externalJobRef` null） | **最高** | 「（その求人のページを直接開くURL）」は現状ほぼ実現できない。①URL行を条件付き（ある行だけ出す）にする、②求人紹介経由エントリーにも `externalJobRef` を後付けする改修を先に行う、③URL行を諦める、のいずれかを**実装前に決める必要がある** |
| 2 | **`openJobPlatformDetail` のURLは求職者に配れない** | **最高** | 5分TTLのCA用SSOトークン付きURL（`openJobPlatformDetail.ts:23`）。案内文に貼っても求職者は開けない。job-platform の**公開求人詳細URL**の形式確認が別途必要（本調査では未確認） |
| 3 | `entryFlagDetail` に master 外の値が22件ある | 高 | 「エントリー/検討中」21件・空文字1件。文言マップは**未知値フォールバック必須**。マップ漏れで空文字の案内文が出ると求職者に送られる |
| 4 | `sort_order` を並び順に流用すると破綻する | 高 | 面接配下の適性検査(12)・所感(14-16)が最終面接(7-9)より後ろ。**コード側に明示的な順位マップを持つ** |
| 5 | 「見送り通知送信済」は有効行に存在しない | 高 | 通知済＝`is_active=false`。見送りを案内文に含めるなら取得条件から `is_active=true` を外す必要がある。ただし外すと過去の全落選（森田さんで14件、全体で2,900件超）が混ざるので**期間や親フラグで絞る設計が必須** |
| 6 | 「適性検査受検中」と DB の「適性検査受講中」の表記ゆれ | 中 | 「受講」→「受検」の変換をコードで行う。DB値を直接文面に出さない |
| 7 | 「書類選考通過」に相当するステータス値が無い | 中 | `documentPassDate` の有無 or `entryFlag>=面接` で判定する。どちらを正とするか要決定（実データでは両者がほぼ一致するが、面接に進んでいるのに `documentPassDate` が空の行が存在しうる） |
| 8 | `aptitudeTestExists` は実質未使用（true が0件） | 中 | 適性検査の判定に使わない。`entryFlagDetail` を見る |
| 9 | `EntryTable.tsx` の `fmtDate`（L109-117）が `toISOString` を使用 | 中 | 新規コードでこれを流用しない。`InterviewGuideCopyModal.tsx:17-20` の `jstYmd()`（`toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})`）に倣う |
| 10 | `entry_flag_masters` の person/company 行は死にデータ | 中 | `entry-flags/route.ts:29-30` は定数ファイルを返す。DBの person 側には `見送り通知済み` が無いのに実データに28件ある。**DBを見て実装すると誤る** |
| 11 | 「選考終了案内」ボタンは同一求職者限定（`EntryBoard.tsx:1198`） | 低 | 案内文は特定の求職者へ送るものなので、同様に `isSameCandidate` ガードを付けるのが自然 |
| 12 | 求人紹介・エントリー段階では見送りの未通知/通知済を区別できない | 低 | `PERSON_FLAG_RULES`（L2-3）に「見送り通知済み」しか無い。この2段階を案内文の対象にするなら仕様上の判断が必要 |

### 未確認事項

1. **job-platform の公開（認証不要）求人詳細URLの形式**。`externalJobRef`（例 `hl-ap-328330`）から求職者が開けるURLを組み立てられるかは、kyuujin-pdf-tool / bizstudio-job-platform 側の確認が必要（本プロンプトは portal 単体完結の指示のため未参照）。
2. **求人紹介経由エントリーに `externalJobRef` を後付けできるか**。`CandidateFile.externalJobRef` や `kyuujinJobId` から遡って解決できる可能性はあるが、突合方法とカバー率は未検証。
3. **「選考中」の定義**。3-4 では `entryFlag='面接'` のうち最終面接以外としたが、書類選考の「選考中」(46件) と文言が重複する。案内文でどう書き分けるか要決定。
4. 集計は 2026-08-08 時点のスナップショット。件数は日々変動する。

---

## 8. 参照ファイル一覧

| ファイル | 行 | 内容 |
|---|---|---|
| `prisma/schema.prisma` | 1729-1862 | `JobEntry`（`externalJobId` 1734 / `originalUrl` 1745 / `entryFlagDetail` 1760 / `externalJobRef` 1767 / `isActive` 1805） |
| `prisma/schema.prisma` | 1933-1943 | `EntryFlagMaster`（選択肢マスタ） |
| `src/lib/constants/entry-flag-rules.ts` | 1-16, 18-36, 46-52, 68-74 | `PERSON_FLAG_RULES` / `COMPANY_FLAG_RULES` / `INACTIVE_TRIGGERS` / 自動遷移（★変更禁止・読むのみ） |
| `src/app/api/entry-flags/route.ts` | 10-31 | 選択肢の供給元（親/子=DB・本人/企業=定数） |
| `src/app/api/candidates/[candidateId]/bookmarks/to-entry/route.ts` | 11-16, 61, 95 | `externalJobRef` が入る唯一の経路（route="site-apply"） |
| `src/app/api/entries/route.ts` | — | 通常のエントリー作成。`externalJobRef` の記述なし（grep 0件） |
| `src/lib/openJobPlatformDetail.ts` | 10-24 | 求人サイト詳細を開く（5分TTLのSSO付きURL） |
| `src/lib/entries/resolveEntryIsActive.ts` | 22-49 | 有効/無効の判定 |
| `src/components/entries/EntryBoard.tsx` | 19-98, 276, 1183-1252, 1274-1276, 1379-1387 | `Entry` 型 / 選択状態 / 一括アクションバー / モーダルマウント |
| `src/components/entries/EntryTable.tsx` | 101, 109-117, 941-972, 1085, 1098-1117 | チェックボックス列 / `toISOString` を使う日付関数（流用不可） / 企業名クリックのURL分岐 |
| `src/components/entries/InterviewGuideCopyModal.tsx` | 1-69 | **今回の機能の雛形**（選択行→テキスト生成→コピー・JST規約準拠） |
| `src/components/entries/EntryDetailModal.tsx` | 191, 196-198 | 親フラグ変更時に詳細を空文字化（乖離の原因） |
