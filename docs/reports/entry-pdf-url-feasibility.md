# エントリーの externalJobId から求人ページURLを組み立てられるか検証

調査日: 2026-08-08 ／ 対象リポジトリ: bizstudio-portal（worktree `C:\bizstudio\portal-2` / ブランチ `sagyou-2`）／ **調査のみ・実装なし**

守った制約: DB操作は **SELECT のみ**。`railway run` 不使用（`railway ssh --service bizstudio-portal` 経由）。kyuujinPDF へは**読み取り専用GET のみ**（`POST /api/external/tokens/issue` は呼んでいない）。`entry-flag-rules.ts` / `candidate-flags.ts` は読むのみ。

前提として読んだもの: `docs/reports/entry-message-generator-survey.md`（e77c696・本リポジトリ）。bizstudio-mypage の `docs/reports/site-per-job-url-survey.md`（e5d5bc2）は別リポジトリのため未参照 — **URL2系統の形式はプロンプトに転記された結論をそのまま前提として採用した**（本調査で独自検証はしていない）。

---

## 1. 結論サマリ（3行）

1. **`externalJobId` から `/pdf/{id}` 形式のURLは組み立てられる（＝可）。** `JobEntry.externalJobId` と `CandidateFile.kyuujinJobId` は**同一ID空間**であることがコード上明記されており（`dashboard/route.ts:157`）、実データでも有効エントリー301件中136件で台帳に同一IDの行が存在した。ただし**HTTP応答による実地検証では「開ける」ことまでは証明できていない**（存在しないIDでも200が返る・4章）。
2. **選考中エントリーの 90.6%（149件中135件）で `/pdf/{id}` を出せる。** `/jobs/{ref}` 形式の5件を足すと **140件・94.0%**（両形式の重複0件）。全有効エントリーで見ると 141/301 = 46.8%（入社済152件がほぼ `externalJobId=0` のため率が下がる）。
3. **前回報告書（e77c696）の結論は修正が必要。** 「1.6%」という数字自体は `externalJobRef` の充足率として正しいが、**`/pdf/{id}` 系統を評価対象から落としていたため「URLを出せるのは1.6%」という結論が誤り**。特に e77c696 の「`externalJobId` … 単体ではURLにならない ❌」という記述は**誤りなので撤回する**。正しくは**選考中の94.0%でURLを組み立てられる**。

---

## 2. 調査項目1: ID体系の一致確認（本調査の中核）

### 2-1. 台帳側の列（`prisma/schema.prisma`）

`CandidateFile`（L1403-1473）に該当列が存在する。**列名は `kyuujinJobId`（DB列 `kyuujin_job_id`・`Int?`）**。

```prisma
// 求人ID紐付け: kyuujinPDF の Job 内部ID（jobs.id・Int）。抽出完了通知(extraction-complete webhook)で
//   ファイル名突合して書き込む。mypage の「担当CAのおすすめ」が会社名照合を廃止しこのIDで直接引くための鍵。
//   externalJobRef（job-platform の UUID）とは別系統。null は未紐付け。
kyuujinJobId      Int?                  @map("kyuujin_job_id")   // schema.prisma:1419
```

一意制約も張られている（L1466）:

```prisma
@@unique([candidateId, kyuujinJobId]) // T-133 P1: 同一候補者×同一kyuujin Jobの重複行防止（NULLは重複扱いされない）
```

### 2-2. `JobEntry.externalJobId` と同じ番号体系か → **同じ。根拠3点。**

**根拠① コード上の明示的な宣言**（決定的）

`src/app/api/candidates/[candidateId]/dashboard/route.ts:157`:

```
* job同一性 = kyuujinJobId（== 旧 externalJobId。両者とも applyJobResponseIntent 経由で同一ID空間）。
```

同ファイル L164 も「`kyuujinJobId` を持たない掲載行（job-platform等）は旧テーブルと衝突しないため個別計上」とし、両者を同一キーとして突合している（L169-174）。

**根拠② エントリー作成時に写している値の出所**

エントリーは求人紹介一覧の行から作られる。`src/components/candidates/HistoryTab.tsx:2597`:

```ts
return {
  externalJobId: j.id,                        // ← kyuujinPDF の job の内部 id
  externalJobNo: overrideNo ?? j.job_id,      // ← 表示用の求人番号（別物）
  companyName: j.company_name,
  ...
```

`j` の型は同ファイル L11-29 の `type Job`。**`id: number`（内部PK）と `job_id: string | null`（求人番号）が別フィールドとして定義されている**ことが読み取れる。

```ts
type Job = {
  id: number;
  job_id: string | null;
  company_name: string;
  ...
```

この `j` の供給元は `src/app/api/candidates/[candidateId]/jobs/route.ts:45-48` で、kyuujinPDF の `GET /api/projects/by-job-seeker-id/{candidateNumber}/jobs` を中継しているだけ。**つまり `externalJobId` = kyuujinPDF の `jobs.id`**。

一方 `kyuujinJobId` は `src/app/api/external/extraction-complete/route.ts:141`（`data: { kyuujinJobId: jobId }`）と `src/lib/mypage-response-sync.ts:379` で書かれ、いずれも kyuujinPDF 側から渡される job id をそのまま格納している。**両者は同じ源から来ている。**

**根拠③ 実データの整合**

同一 `candidate_id` × 同一ID での突合が **136件成立**（下記2-3）。番号体系が違えば偶然一致することはほぼない。

**注意（別系統との混同）**: `CandidateFile.externalJobRef`（schema.prisma:1415）と `JobEntry.externalJobRef`（同1767）は **job-platform の source_job_id** であり、`kyuujinJobId` / `externalJobId` とは**別系統**。schema のコメント（L1418）が「`externalJobRef`（job-platform の UUID）とは別系統」と明記している。前回報告書はこちらだけを見ていた。

### 2-3. 実データ集計（本番DB・SELECT のみ・2026-08-08 時点）

```sql
SELECT count(*)::int AS active_total,
       (count(*) FILTER (WHERE e.external_job_id > 0))::int AS with_kyuujin_id,
       (count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM candidate_files f
          WHERE f.candidate_id = e.candidate_id AND f.kyuujin_job_id = e.external_job_id
       )))::int AS matched_in_ledger
FROM job_entries e WHERE e.is_active = true;
```

**全有効エントリー**

| 指標 | 件数 | 対母数比 |
|---|---|---|
| 有効エントリー総数（`is_active=true`） | **301** | 100% |
| うち `external_job_id > 0` | 143 | 47.5% |
| うち **台帳に同一求人IDの行が存在（`matched_in_ledger`）** | **136** | **45.2%** |
| 　└ そのうち台帳行が未アーカイブ | 136 | 45.2% |
| 　└ さらに `response_status <> 'EXCLUDED'` | 135 | 44.9% |
| `external_job_ref` あり（`/jobs/{ref}` 形式） | 5 | 1.7% |

**選考中（`entry_flag IN ('エントリー','書類選考','面接','内定')`）**

| 指標 | 件数 | 対母数比 |
|---|---|---|
| 選考中の有効エントリー | **149** | 100% |
| うち `external_job_id > 0` | 142 | 95.3% |
| うち **台帳に同一求人IDの行が存在** | **135** | **90.6%** |
| 　└ 未アーカイブ | 135 | 90.6% |
| 　└ さらに EXCLUDED でない | 134 | 89.9% |
| `external_job_ref` あり | 5 | 3.4% |
| **`/pdf/{id}` または `/jobs/{ref}` のどちらかを出せる** | **140** | **94.0%** |
| 　└ 両方出せる（重複） | **0** | 0% |
| **どちらも出せない** | **9** | 6.0% |

**→ `matched_in_ledger` = 135件が、選考中エントリーで実際にURLを出せる件数の上限（90.6%）。** `/jobs/{ref}` の5件と合わせて 140件・94.0%。

`entryFlag` 別の内訳:

| entry_flag | 有効件数 | `external_job_id>0` | 台帳一致 | 一致率 |
|---|---|---|---|---|
| 入社済 | 152 | **1** | **1** | 0.7% |
| 書類選考 | 59 | 54 | 51 | 86.4% |
| 面接 | 47 | 46 | 45 | 95.7% |
| エントリー | 29 | 29 | 27 | 93.1% |
| 内定 | 14 | 13 | 12 | 85.7% |

**全体率（45.2%）が低く見えるのは入社済152件が原因**。入社済は過去のFileMaker一括取込等で作られており `external_job_id=0` がほぼ全件（151/152）。案内文の対象は選考中なので、実務上効くのは **90.6%** の方。

`external_job_id > 0` なのに台帳に無い7件（有効・全体）の内訳:

| job_db | route | 件数 |
|---|---|---|
| Circus | (null) | 3 |
| HITO-Link | (null) | 3 |
| マイナビJOB | (null) | 1 |

選考中で**どちらの形式も出せない9件**の内訳（1行1件）:

| # | job_db | entry_flag | external_job_id | 状況 |
|---|---|---|---|---|
| 1 | Circus | エントリー | 5214 | ID有・台帳なし |
| 2 | Circus | 書類選考 | 5216 | ID有・台帳なし |
| 3 | Circus | 書類選考 | 9226 | ID有・台帳なし |
| 4 | HITO-Link | エントリー | 9617 | ID有・台帳なし |
| 5 | HITO-Link | 書類選考 | 3117 | ID有・台帳なし |
| 6 | HITO-Link | 面接 | 5418 | ID有・台帳なし |
| 7 | マイナビJOB | 内定 | 3735 | ID有・台帳なし |
| 8 | HITO-Link | 内定 | **0** | ID無（手動作成） |
| 9 | HITO-Link | 面接 | **0** | ID無（手動作成） |

**9件中7件は `external_job_id > 0` で台帳側に行が無いだけ**なので、台帳へ `kyuujin_job_id` を後付けできれば救済しうる。残り2件は `external_job_id = 0`（手動作成）で救済不可。

**参考: 無効行（見送り通知済み）でURLを出せるか**

案内文に見送り済みを含める場合の上限:

| 指標 | 件数 |
|---|---|
| `is_active=false` かつ `person_flag IN ('見送り通知送信済','見送り通知済み')` | 2,997 |
| うち台帳に同一求人IDの行が存在 | **467（15.6%）** |

古い落選行ほど台帳の紐付けが無い（`kyuujinJobId` の後付けは T-133 以降の仕組みのため）。**見送り済みを案内文に含めると、URLが付く行と付かない行が混在する。**

---

## 3. 調査項目2: 台帳側の突合状況

```sql
SELECT count(*)::int AS bookmark_total,
       (count(*) FILTER (WHERE kyuujin_job_id IS NOT NULL))::int AS with_kyuujin_id,
       (count(*) FILTER (WHERE kyuujin_job_id IS NULL))::int AS null_kyuujin_id,
       (count(*) FILTER (WHERE archived_at IS NULL))::int AS not_archived
FROM candidate_files WHERE category = 'BOOKMARK';
```

| 指標 | 件数 | 割合 |
|---|---|---|
| `category='BOOKMARK'` の台帳行 総数 | **8,047** | 100% |
| うち `kyuujin_job_id` あり | 5,176 | 64.3% |
| うち **`kyuujin_job_id` が null（突合失敗）** | **2,871** | **35.7%** |
| 未アーカイブ行 | 6,749 | 83.9% |
| 　└ うち `kyuujin_job_id` あり | 5,117 | 75.8%（対未アーカイブ） |
| 　└ うち **null（突合失敗）** | **1,632** | **24.2%**（対未アーカイブ） |

**→ 現に表示される（未アーカイブ）台帳行の 24.2% が「会社名だけの薄いカード」でリンクを持たない。**

`source_type` 別（未アーカイブのみ）:

| source_type | 件数 | うち `kyuujin_job_id` null | null率 |
|---|---|---|---|
| （null＝PDF由来） | 4,940 | 1,402 | **28.4%** |
| job-platform | 1,809 | 230 | **12.7%** |

PDF由来の方が突合失敗が多い。`extraction-complete` webhook が**ファイル名突合**で `kyuujinJobId` を書き込む方式（schema.prisma:1416-1418）のため、ファイル名が揺れると紐付かない。

**求職者単位で見た突合失敗の広がり**（未アーカイブ BOOKMARK 行を持つ求職者）:

| 指標 | 人数 | 割合 |
|---|---|---|
| ブックマークを1件以上持つ求職者 | **291** | 100% |
| うち **1件でも突合失敗行を持つ** | **179** | **61.5%** |
| うち **全件が突合失敗** | **60** | **20.6%** |

支援中（`support_status='ACTIVE'`）に絞ると:

| 指標 | 人数 | 割合 |
|---|---|---|
| ブックマークを持つ ACTIVE 求職者 | **97** | 100% |
| うち1件でも突合失敗行を持つ | **55** | **56.7%** |

**→ 「求職者の6割は台帳に穴がある」が、案内文が対象にするのは選考中エントリーに対応する行だけなので、実効カバー率は 90.6%（2-3）が正しい指標。** 台帳全体の穴（24.2%）とエントリー側のカバー率（90.6%）が食い違うのは、**エントリーまで進んだ求人は突合に成功している率が高い**ため（CAが求人紹介一覧＝kyuujinPDF側から選んで作るため、そもそもIDが確定している）。

---

## 4. 調査項目4: URL組み立ての実地検証

### 4-1. 本人トークンの取得（読み取り専用GET）

`GET {KYUUJIN_API_URL}/api/external/mypage/by-job-seeker/5008186`（ヘッダ `x-api-secret`）をコンテナ内から実行。**発行API（`POST /api/external/tokens/issue`）は呼んでいない。**

| 項目 | 結果 |
|---|---|
| HTTP ステータス | **200** |
| `url` の有無 | あり |
| `expires_at` | `9999-12-31T23:59:59`（実質無期限） |
| `access_count` | 23 |
| token が求職者番号で始まるか | **true**（`5008186-...`） |

### 4-2. `/site/{token}/pdf/{external_job_id}` へのアクセス結果

| # | URL | HEAD | GET | Location | 本文サイズ |
|---|---|---|---|---|---|
| 1 | `/site/{token}/pdf/9298`（アフラック・**台帳一致あり**） | **200** | **200** | — | 9,741 B |
| 2 | `/site/{token}/pdf/9299`（オリックス・**台帳一致あり**） | **200** | **200** | — | 9,741 B |
| 3 | `/site/{token}/pdf/99999999`（**存在しないID・対照**） | **200** | **200** | — | 9,753 B |
| 4 | `/site/{token}/jobs/hl-ap-328330`（参考・`/jobs/` 形式） | **200** | **200** | — | 9,767 B |
| 5 | `/site/{token}`（サイトルート・対照） | **200** | **200** | — | 9,569 B |

### 4-3. この200をどう解釈すべきか → **「開ける」証拠にはならない**

**対照実験の結果、存在しない求人ID `99999999` でも同じ 200 が返った。** さらに本文を確認したところ、実在ID・存在しないIDのどちらも**同一のクライアントシェル**だった:

| URL | `<title>` | ログインUIの文字列 | 本文長 |
|---|---|---|---|
| `/pdf/9298`（実在） | `求人をさがす \| BizStudio` | なし | 9,741 B |
| `/pdf/99999999`（存在せず） | `求人をさがす \| BizStudio` | なし | 9,753 B |

いずれも `<!DOCTYPE html><html lang="ja" ...>` で始まる Next.js のクライアントレンダリング用シェルであり、**実際の求人内容はブラウザ側で Cookie 認証後に取得される**構造。したがって:

- ✅ **言えること**: `/site/{token}/pdf/{id}` というルートは mypage 側に存在し、404 やログインへのリダイレクトを返さない
- ❌ **言えないこと**: そのIDの求人が実際に表示されるか。**HTTPステータスは有効IDと無効IDを区別しない**ため、200 は成功の証拠にならない
- ❌ **言えないこと**: 求職者がログインした状態で目的の求人カードに着地するか

**→ 実表示の確認には、ログイン済みブラウザセッションでの目視確認が必須**（本調査の範囲外）。フィードバック送信（応募したい／気になる）に相当する操作は一切行っていない。

---

## 5. 調査項目3: 森田さんの実データ

### 5-1. 「森田」を含む求職者（6名・氏名の正確な表記）

| 求職者番号 | 氏名（正確な表記） | カナ | supportStatus | supportSubStatus | エントリー |
|---|---|---|---|---|---|
| 5001234 | **森田 成美** | モリタ ナルミ | BEFORE | 面談前 | 0件 |
| 5001894 | **森田 道幹** | モリタ ミチマサ | BEFORE | 面談前 | 0件 |
| 5002705 | **森田 麻中** | モリタ マナカ | BEFORE | 面談前 | 0件 |
| 5004220 | **森田 水萌** | モリタ ミホ | BEFORE | 面談前 | 0件 |
| 5008048 | **森田 良** | モリタ リョウ | ENDED | 当社判断 | 0件 |
| **5008186** | **森田 倫名** | **モリタ リンナ** | **ACTIVE** | **面接** | **22件** |

**該当は 5008186「森田 倫名（モリタ リンナ）」1名**。姓と名の間は**半角スペース1つ**。

### 5-2. 有効エントリー（`is_active = true`）8件

| # | 会社名 | entry_flag | detail | person_flag | company_flag | 書類通過日 | external_job_id | 台帳一致 | external_job_ref | **URL可否** |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | オリックス自動車株式会社 | 面接 | 適性検査受講中 | 受講完了確認済 | 受講完了報告前 | 2026-07-30 | **9299** | **あり(1)** | — | ✅ `/pdf/9299` |
| 2 | **アフラック生命保険株式会社** | 面接 | 適性検査受講中 | 受講完了未確認 | 受講完了報告前 | **2026-08-02** | **9298** | **あり(1)** | — | ✅ `/pdf/9298` |
| 3 | 日本電技株式会社 | 書類選考 | 選考中 | — | — | — | **9890** | **あり(1)** | — | ✅ `/pdf/9890` |
| 4 | リックス株式会社 | 書類選考 | 選考中 | — | — | — | **9886** | **あり(1)** | — | ✅ `/pdf/9886` |
| 5 | 株式会社日本カードネットワーク | 面接 | 一次日程調整中 | 日程回収済 | 希望日提出済 | **2026-08-04** | **9305** | **あり(1)** | — | ✅ `/pdf/9305` |
| 6 | 株式会社もしも | 書類選考 | 選考中 | — | — | — | **9892** | **あり(1)** | — | ✅ `/pdf/9892` |
| 7 | 青山特殊鋼株式会社 | 書類選考 | 選考落ち | **見送り通知未送信** | — | — | 0 | なし | `hl-ap-322908` | ✅ `/jobs/hl-ap-322908` |
| 8 | 株式会社アドバンテッジリスクマネジメント | 書類選考 | 選考中 | — | — | — | 0 | なし | `hl-ap-328330` | ✅ `/jobs/hl-ap-328330` |

**→ 8件中 8件（100%）でURLを組み立てられる。** 内訳は `/pdf/{id}` 6件 ＋ `/jobs/{ref}` 2件。

**前回報告書（e77c696）は同じ8件を「URLを出せるのは2件（25%）」としていたが、これは誤り。** `/pdf/{id}` 形式を評価していなかったため6件を取りこぼしていた。

### 5-3. 無効エントリー（`is_active = false`）14件

| # | 会社名 | entry_flag | detail | person_flag | external_job_id | 台帳一致 | **URL可否** |
|---|---|---|---|---|---|---|---|
| 9 | 株式会社ユーラスエナジーホールディングス | 書類選考 | 選考落ち | 見送り通知送信済 | 9304 | あり(1) | ✅ `/pdf/9304` |
| 10 | 株式会社カシワバラ・コーポレーション | 書類選考 | 選考落ち | 見送り通知送信済 | 9301 | あり(1) | ✅ `/pdf/9301` |
| 11 | 野村不動産パートナーズ株式会社 | エントリー | クローズ | 見送り通知済み | 9307 | あり(1) | ✅ `/pdf/9307` |
| 12 | 株式会社ザイマックスグループ | 書類選考 | 選考落ち | 見送り通知送信済 | 9313 | あり(1) | ✅ `/pdf/9313` |
| 13 | 大塚商会 | 書類選考 | 選考落ち | 見送り通知送信済 | 9300 | あり(1) | ✅ `/pdf/9300` |
| 14 | 税理士法人レガシィ | 書類選考 | 選考落ち | 見送り通知送信済 | 9306 | あり(1) | ✅ `/pdf/9306` |
| 15 | 株式会社フジキン | エントリー | クローズ | 見送り通知済み | 9903 | あり(1) | ✅ `/pdf/9903` |
| 16 | 株式会社ユーラスエナジーホールディングス | 書類選考 | 選考落ち | 見送り通知送信済 | 9303 | あり(1) | ✅ `/pdf/9303` |
| 17 | 株式会社キャピタル・アセット・プランニング | エントリー | クローズ | 見送り通知済み | 9887 | あり(1) | ✅ `/pdf/9887` |
| 18 | 株式会社丹青ディスプレイ | 書類選考 | 選考落ち | 見送り通知送信済 | 9893 | あり(1) | ✅ `/pdf/9893` |
| 19 | 株式会社テレビ朝日メディアプレックス | エントリー | クローズ | 見送り通知済み | 9902 | あり(1) | ✅ `/pdf/9902` |
| 20 | マンパワーグループ株式会社 | エントリー | クローズ | 見送り通知済み | 9888 | あり(1) | ✅ `/pdf/9888` |
| 21 | リコーリース株式会社 | エントリー | クローズ | 見送り通知済み | 9898 | あり(1) | ✅ `/pdf/9898` |
| 22 | インターテック・サーティフィケーション株式会社 | エントリー | クローズ | 見送り通知済み | 9308 | あり(1) | ✅ `/pdf/9308` |

**→ 無効14件も全件（100%）台帳一致あり。** 森田さんは全22件でURLを出せる。

**注意**: 森田さんは全体平均より条件が良い。理由は台帳の充実度で、`candidate_files`（BOOKMARK）97件のうち **73件に `kyuujin_job_id` あり**、未アーカイブ77件のうち73件が紐付き済み（未紐付けは4件のみ＝5.2%）。全体の未アーカイブ null率24.2%より大幅に良い。**森田さんの結果を全体に外挿してはいけない。**

**注意（データの可動性）**: `株式会社日本カードネットワーク` の `document_pass_date` は前回調査（2026-08-07）時点では未入力だったが、本調査（2026-08-08）では `2026-08-04` が入っている。件数・日付は日々動く。

---

## 6. 調査項目5: 見送り済みエントリーの拾い方

`person_flag` の実値と件数（全 `JobEntry`・`is_active` 別）:

| person_flag | is_active | 件数 |
|---|---|---|
| 辞退受付済 | false | 3,341 |
| **見送り通知送信済** | **false** | **2,969** |
| 入社済 | true | 143 |
| 日程通知済 | false | 83 |
| **見送り通知未送信** | **false** | **51** |
| **見送り通知済み** | **false** | **28** |
| **見送り通知未送信** | **true** | **23** |
| 日程通知済 | true | 22 |
| 内定通知済 | false | 20 |
| 日程回収中 | false | 17 |
| 日程回収中 | true | 7 |
| 入社案内通知済 | true | 5 |
| 選考通過連絡前 | false | 5 |
| 日程回収済 | true | 5 |
| 内定通知済 | true | 5 |
| （以下 3件以下は省略） | | |

**見送り関連3値の整理:**

| 値 | 意味 | 総数 | `is_active=true` | `is_active=false` |
|---|---|---|---|---|
| **見送り通知送信済** | **本人へ通知済み**（書類選考/面接） | 2,969 | **0** | 2,969 |
| **見送り通知済み** | **本人へ通知済み**（求人紹介/エントリー） | 28 | **0** | 28 |
| **見送り通知未送信** | **見送り確定だが本人未通知** | 74 | **23** | 51 |

**確認結果:**

1. **「通知済み」2値（送信済 2,969件 ＋ 済み 28件 = 2,997件）は例外なく `is_active=false`。** `INACTIVE_TRIGGERS.personFlags = ["見送り通知送信済", "見送り通知済み"]`（`entry-flag-rules.ts:49`）のとおりで、有効行に1件も残っていない。
2. **「見送り確定だが本人未通知」＝ `見送り通知未送信`。** 74件中 **23件が有効行**として画面に残っている（残り51件は別要因、例えば `companyFlag='辞退報告済'` で無効化された行）。

**→ 案内文に「本人へ通知済みの見送り」だけを載せるなら、条件は `person_flag IN ('見送り通知送信済','見送り通知済み')` であり、これは必然的に `is_active = false` の行を読むことになる。** エントリー管理画面の通常表示（有効行）からは1件も拾えない。

**ただし 2-3 のとおり、この2,997件のうち台帳一致があるのは 467件（15.6%）のみ。** 通知済み見送りを案内文に載せると、大半はURLなしの行になる。

---

## 7. 未確認事項

1. **`/pdf/{id}` で実際に求人が表示されるか。** 4-3 のとおり HTTP 200 は有効IDと無効IDを区別しないため、成功の証拠にならない。**ログイン済みブラウザでの目視確認が必要**。1件確認すれば足りる（読み取りのみなので安全）。
2. **URL2系統の形式そのもの**（`/site/{token}/pdf/{id}` と `/site/{token}/jobs/{id}`）は bizstudio-mypage の調査（e5d5bc2）の結論をプロンプト経由で前提採用したもので、**本調査では mypage 側のルーティング実装を確認していない**。
3. **台帳一致があってもサイト上でカードが表示されない条件があるか。** `response_status='EXCLUDED'` の行（選考中で1件）や、mypage 側の可視性ルールは portal から確認できない。本報告の 90.6% は「台帳に行がある」ことの上限値であり、表示可否の保証ではない。
4. **`/pdf/{id}` の `{id}` が本当に `jobs.id` か。** 2-2 の根拠は portal 側のコードとコメントで、kyuujinPDF / mypage 側のルート実装は未参照。ID空間の一致は強く裏付けられているが、mypage のルートが同じIDを受けることの直接確認は残っている。
5. **台帳一致しない選考中9件の救済可否。** 7件は `external_job_id > 0` なので、台帳側に `kyuujin_job_id` を後付けできれば救済できる可能性がある（会社名/求人名での突合）。カバー率と誤紐付けリスクは未検証。
6. 集計は 2026-08-08 時点のスナップショット。有効エントリー数は前回調査（8/07）の306件から301件に変動しており、件数は日々動く。

---

## 8. 前回報告書（e77c696）の修正点

| e77c696 の記述 | 判定 | 正しい内容 |
|---|---|---|
| 「`externalJobId` … 指すもの: kyuujinPDF 側の求人内部ID / **URL化できるか: ❌ 単体ではURLにならない**」（2-1 表） | **誤り・撤回** | `CandidateFile.kyuujinJobId` と同一ID空間であり、台帳に行があれば `/site/{token}/pdf/{externalJobId}` を組み立てられる |
| 「求人サイトのURLを出せるのは有効エントリー306件中5件（1.6%）」（結論サマリ1） | **数字は正しいが結論が誤り** | 1.6% は `externalJobRef` の充足率としては正しい。しかし `/pdf/{id}` 系統を含めると **選考中の94.0%**（140/149）でURLを出せる |
| 「選考中154件に絞っても5件（3.2%）」 | **同上** | 選考中149件中 **140件（94.0%）**。`/pdf/` 135件 ＋ `/jobs/` 5件 |
| 「森田さんの有効8件中 URLを出せるのは2件（25%）」（6-2 表） | **誤り** | **8件中8件（100%）**。`/pdf/` 6件 ＋ `/jobs/` 2件 |
| 「懸念#1: URLがほぼ出せない（98.4%が `externalJobRef` null）／深刻度 最高」 | **格下げ** | 選考中の未カバーは6.0%（9件）。深刻度は「最高」ではなく「中」。ただし**入社済・通知済み見送りは依然カバー率が低い**（それぞれ0.7%・15.6%） |
| 「懸念#2: `openJobPlatformDetail` のURLは求職者に配れない（5分TTLのSSO）」 | **維持（正しい）** | これは CA が portal 内で開くための別経路。求職者向けは `/site/{token}/...` を使う。混同しないこと |
| 3章（選考状況の値・乖離）、4章（見送り判定）、5章（画面構造） | **維持** | 本調査でも `person_flag` の分布・`INACTIVE_TRIGGERS` の挙動は同じ結果を再確認した |

---

## 9. 参照ファイル一覧

| ファイル | 行 | 内容 |
|---|---|---|
| `prisma/schema.prisma` | 1403-1473 | `CandidateFile`（`externalJobRef` 1415 / **`kyuujinJobId` 1419** / `responseStatus` 1423 / 一意制約 1466） |
| `prisma/schema.prisma` | 1729-1862 | `JobEntry`（`externalJobId` 1734 / `externalJobRef` 1767 / `isActive` 1805） |
| `src/app/api/candidates/[candidateId]/dashboard/route.ts` | **157**, 164-174 | **「kyuujinJobId（== 旧 externalJobId。両者とも同一ID空間）」＝ID一致の決定的根拠** |
| `src/components/candidates/HistoryTab.tsx` | 11-29, **2597-2598** | `type Job`（`id` と `job_id` は別物）／`externalJobId: j.id` の代入 |
| `src/app/api/candidates/[candidateId]/jobs/route.ts` | 45-48 | `j` の供給元＝kyuujinPDF `by-job-seeker-id/{num}/jobs` の中継 |
| `src/app/api/external/extraction-complete/route.ts` | 105-144 | `kyuujinJobId` をファイル名突合で書き込む（突合失敗＝null の発生源） |
| `src/lib/mypage-response-sync.ts` | 326-379 | サイト回答同期時の `kyuujinJobId` 書き込み |
| `src/app/api/entries/route.ts` | 163-174 | 手動作成は `externalJobId: 0` 固定 |
| `src/app/api/candidates/[candidateId]/entries/route.ts` | 60-96 | 求人紹介からのエントリー作成（`externalJobId` をそのまま保存） |
| `src/lib/constants/entry-flag-rules.ts` | 46-52 | `INACTIVE_TRIGGERS`（★変更禁止・読むのみ） |
| `docs/reports/entry-message-generator-survey.md` | — | 前回調査（e77c696）。8章で修正点を整理 |
