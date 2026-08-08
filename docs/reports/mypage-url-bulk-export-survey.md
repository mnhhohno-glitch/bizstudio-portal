# マイページURL一括書き出しの可否調査

調査日: 2026-08-07 ／ 対象リポジトリ: bizstudio-portal（master）／ **調査のみ・実装なし**

前提として守った制約: 新規トークン発行API（`POST /api/external/tokens/issue`）は**一切呼んでいない**。DB操作は SELECT のみ。`railway run` 不使用（`railway ssh --service bizstudio-portal` 経由）。

---

## 1. 結論サマリ（3行）

1. **URL発行は冪等**。CA が貼るURLの取得経路のうち、portal の「求人マイページ」モーダルは kyuujinPDF の**読み取り専用GET**（`by-job-seeker`）で既存トークンを引くだけで、発行は一切しない。発行系（`tokens/issue`）も kyuujinPDF 側が冪等で既存トークンを返す（`issued:false`）が、**今回の一括書き出しでは呼ぶ必要がない**。
2. 一括書き出しは **方式B**（求職者ごとに kyuujinPDF の既存API＝読み取り専用エンドポイントを呼ぶ）。portal DB にはトークン／URLを保持するカラムが**存在しない**（方式Aは不可）。
3. **既存URLを壊さずに一覧化できる（可）**。読み取り専用GETのみで完結し、支援中(ACTIVE)102名に対する実測でも 97名分のURLを 0.8秒・エラー0・新規発行0 で取得できた。

---

## 2. 調査項目1: マイページURL取得APIの実装確認

### 2-1. `GET /api/candidates/[candidateId]/mypage`（求人マイページモーダルの裏側）

ファイル: `src/app/api/candidates/[candidateId]/mypage/route.ts`

- **URLの取得元**: portal DB ではなく **kyuujinPDF のAPIを中継**している。portal DB から読むのは `candidateNumber` と `birthday` のみ（L22-25）。

```ts
// route.ts:31
const externalUrl = `https://web-production-95808.up.railway.app/api/external/mypage/by-job-seeker/${candidate.candidateNumber}`;
```

- **呼び出しているエンドポイントとパラメータ**（L37-40）:

```ts
const res = await fetch(externalUrl, {
  headers: { "x-api-secret": secret },
  next: { revalidate: 0 },
});
```

  - メソッド: **GET**（`method` 省略）。リクエストボディなし。パスパラメータは `candidateNumber` 1つのみ。認証は `x-api-secret`（`process.env.KYUUJIN_API_SECRET`、L14）。

- **冪等性**: **完全に冪等（既存トークンの参照のみ・発行しない）**。根拠は3点。
  1. コード上、このルートに**書き込み系の呼び出しが存在しない**。`fetch` は上記1箇所のみで GET、portal DB への書き込みも無い（`prisma.candidate.findUnique` のみ・L22）。
  2. 同じエンドポイントを使う `site-preview-url/route.ts` のヘッダコメントが、この API の性質を明記している（L15-19）:

     ```
     // トークン取得経路:
     //   - kyuujinPDF GET /api/external/mypage/by-job-seeker/{candidateNumber}（x-api-secret）が
     //     アクティブな ShareToken の /v/{token} URL を返す。未発行なら url:null。
     //   - 未発行（url:null / candidateNumber 未設定）は 409（reason:"no-token"）で「URL未発行」を返す。
     //     ＝ プレビューは新規トークンを発行しない（issue は別ボタンの責務）。
     ```
  3. **実測（本調査・読み取りのみ）**: トークン未発行が濃厚な候補者（`support_status='BEFORE'` かつ誕生日なし・面談記録なし、番号 5000699）に対して GET したところ、**HTTP 200 / `{"url":null,"message":...}`** が返り、発行は起きなかった。既存 `share_token` 検索の有無・`expires_at` 判定は kyuujinPDF 側の実装だが、レスポンスに `expires_at` がそのまま含まれることから**既存レコードを引いて返す読み取りAPI**であることが裏付けられる。

- **返却されるURLの形式**（実測・テストアカウント 5999999）:

```json
{"url":"https://mypage.bizstudio.co.jp/v/5999999-p6stpoj7",
 "expires_at":"9999-12-31T23:59:59","access_count":307,
 "last_accessed_at":"2026-08-03T12:20:53.315097",
 "created_at":"2026-04-05T01:16:42.204412","views_daily_30d":[...]}
```

  - **`https://mypage.bizstudio.co.jp/v/{token}`**（**旧**マイページ）。`{token}` は `{求職者番号}-{8文字英数}` 形式。
  - portal 側はこれに `?admin=true&secret=...` を付けた `adminUrl` も作って返す（route.ts:62-64）。**この adminUrl は secret を含むため、求職者に配ってはならない**（管理者プレビュー専用）。

- **CA が実際に求職者へ貼っているURLは `/v/` ではなく `/site/`**。取得経路が別（下記2-2）である点が本件の最重要ポイント。

### 2-2. CA が貼るURLの正しい出所 —「求人サイトURLを発行」ボタン

| # | 導線 | 実装 | 返すURL | 発行するか |
|---|---|---|---|---|
| 1 | **求人サイトURLを発行**（CAが案内文に貼る本命） | `src/components/candidates/IssueSiteTokenButton.tsx:118` → `POST /api/candidates/[candidateId]/issue-site-token` → kyuujinPDF `POST /api/external/tokens/issue` | `https://mypage.bizstudio.co.jp/site/{token}` | **する**（冪等・既存があれば再利用） |
| 2 | サイトをプレビュー | `SitePreviewButton.tsx` → `POST /api/candidates/[candidateId]/site-preview-url` | `/site/preview?pt={署名}`（15分限定・CA閲覧専用） | しない（読み取りのみ） |
| 3 | 求人マイページ（📱モーダル） | `CandidateDetailPage.tsx:1781` → `GET /api/candidates/[candidateId]/mypage` | `/v/{token}`（**旧**マイページ） | しない（読み取りのみ） |

ボタン1・2の設置箇所は `src/components/candidates/CandidateHeader.tsx:345-346`:

```tsx
<IssueSiteTokenButton candidateId={candidate.id} candidateName={candidate.name} hasBirthday={!!candidate.birthday} />
<SitePreviewButton candidateId={candidate.id} hasBirthday={!!candidate.birthday} />
```

モーダル3（求人マイページ）のUIは `CandidateDetailPage.tsx:2013-2079`（URL入力欄＋「📋 URLをコピー」＋「🔗 管理者プレビュー」）。

**発行系ルートの冪等性**（今回は呼んでいない・コードとレポートによる確認のみ）:

`src/app/api/candidates/[candidateId]/issue-site-token/route.ts:5-11`

```ts
// T-128 公開準備②: 求人サイトURL発行ボタンのバックエンド。
// portal（セッション認証）→ kyuujinPDF POST /api/external/tokens/issue（x-api-secret）を代理呼び出し。
// kyuujinPDF 側は冪等（同一 candidateNumber は既存トークンの siteUrl を返す）。
```

- レスポンスの `issued` が `true`=新規 / `false`=既存（route.ts:82）。
- `docs/reports/T-128-token-rollout.md:11, 79` に実測記録あり（一括発行84件中 **既存77件・新規7件**、単体E2Eで `issued:false`）。
- **ただし本件では呼ぶ必要がない**（下記3参照）。誤って呼ぶと期限切れトークンへの `warning` 判定など副作用の検討が必要になるため、一括書き出しでは使わない方針が安全。

### 2-3. `/v/{token}` から `/site/{token}` を導出できる根拠

`src/lib/candidate-site/preview-url.ts:13-14, 82-86` が、両者のトークンが**同一値**であることを仕様として明記している。

```ts
//   - token : ShareToken 文字列（kyuujinPDF の /v/{token} の {token} と同一値）
...
/** kyuujinPDF の `/v/{token}` 形式URLから token 部分を抽出。取れなければ null。 */
export function extractTokenFromMypageUrl(url: string): string | null {
  const m = url.match(/\/v\/([^/?#]+)/);
  return m ? m[1] : null;
}
```

実URLの実測記録:
- `docs/reports/job-export-guide-text-legacy-mypage-url-investigation.md:72` — 発行ボタンの返すURLは `https://mypage.bizstudio.co.jp/site/{candidateNumber}-{token}`
- `docs/reports/url-modal-open-button-and-template.md:36` — 実測 `https://mypage.bizstudio.co.jp/site/5008190-3o8j90av` でログイン画面表示を確認

**本調査の実測**: 支援中(ACTIVE)でURLを持つ **97件すべて**が `https://mypage.bizstudio.co.jp/v/{token}` 形式に完全一致し（形式不一致 0件）、**97件すべてで token が `{その求職者番号}-` で始まっていた**（前置不一致 0件）。したがって `/v/` → `/site/` の文字列置換で CA が貼るURLを機械的に再構成できる。

---

## 3. 調査項目2: portal 側にURL/トークンを保存しているか

**保存していない。**

`prisma/schema.prisma` の `Candidate` モデル（L453-554）を全フィールド確認したが、`token` / `mypageUrl` / `shareUrl` / `projectUrl` / `siteUrl` に相当するカラムは**存在しない**。

`token` を持つモデルは以下のみで、いずれも**マイページとは無関係**:

| モデル | 行 | 用途 |
|---|---|---|
| `Invite.tokenHash` | schema.prisma:184 | 社員招待 |
| `FileShareLink.token` | schema.prisma:557 | 書類共有リンク |
| `GuideEntry.token` | schema.prisma:612 | ガイド（面談前アンケート） |
| `AppToken.tokenHash` / `AppSession.sessionTokenHash` | schema.prisma:626, 641 | アプリ認証 |
| `JimuSession.token` | schema.prisma:669 | 事務セッション |
| `ScheduleLink.token` | schema.prisma:684 | 日程調整 |
| `SecureTransfer.token` | schema.prisma:2718 | セキュアファイル送信（T-147） |

`CandidateFile`（L1440-）にも該当カラムなし。

→ **DB SELECT による実データ確認は不要**（そもそもカラムが無いため）。代わりに、対象母集団の件数確認（下記5）を SELECT のみで実施した。

---

## 4. 調査項目3: 一括書き出し方式の判定

### **方式B**（求職者ごとに kyuujinPDF の既存API＝読み取り系を呼ぶ）

- 方式A（portal DB のみで完結）: **不可**。保存カラムが存在しない（上記3）。
- 方式C（kyuujinPDF のDB直読み）: **不要**。portal から読み取り専用APIで足りる。

### 新規発行を伴わない読み取り専用エンドポイントの存在: **存在する**

`GET https://web-production-95808.up.railway.app/api/external/mypage/by-job-seeker/{candidateNumber}`（ヘッダ `x-api-secret`）

portal 側での利用実績（＝portal に実装済みのクライアントが3本ある）:

| 呼び出し元 | 行 | 用途 |
|---|---|---|
| `src/app/api/candidates/[candidateId]/mypage/route.ts` | 31, 37 | 求人マイページモーダル |
| `src/app/api/candidates/[candidateId]/site-preview-url/route.ts` | 72 | プレビューURLのトークン取得 |
| `src/app/api/candidates/[candidateId]/dashboard/route.ts` | 73 | 閲覧回数・最終ログイン・14日推移 |

レスポンスのキー（実測）: `url` / `expires_at` / `access_count` / `last_accessed_at` / `created_at` / `views_daily_30d`。未発行時は `{ url: null, message: ... }`（HTTP 200）。

**注意（軽微な既存不整合）**: `mypage/route.ts:68` は `isActive: data.is_active ?? false` を返しているが、実レスポンスに `is_active` キーは**含まれていない**ため常に `false` になる。現在この値はUIで使われていないため実害はないが、一覧化で「有効/無効」列を作る場合はこの値を信用してはいけない（`expires_at` で判定すること）。

### 一括読み取りの専用エンドポイントは portal 側に見当たらない

portal のコードから参照されている kyuujinPDF の一括系は `GET /api/external/mypage/feedbacks`（`scripts/sync-mypage-responses.ts:38-40`）のみで、これは**回答（feedback）の一括取得**であり、トークン/URLの一覧を返すものではない。**トークン一覧を一括で返す読み取りAPIは portal 側の実装・型定義からは確認できない**。したがって求職者ごとに `by-job-seeker` をループする必要がある。

**コストは問題にならない**: 支援中102名に対して並列5で実行し、**102リクエストが 779ms・エラー0**（本調査の実測）。

### 既存の一括「発行」スクリプトとの違い（混同注意）

`scripts/issue-site-tokens-bulk.ts` が既に存在するが、これは **`POST /api/external/tokens/issue` を叩く発行スクリプト**（L58-65）であり、CSVにも `candidateNumber, result, warning, skipReason` しか出さず **URLを出力しない**（L220）。今回の要件（既存URLの書き出し）には**使えない／使うべきでない**。

---

## 5. 調査項目4: 対象求職者の絞り込み条件

以下はすべて `railway ssh --service bizstudio-portal` 経由の **SELECT のみ**で取得（2026-08-07 時点）。

### 5-1. `Candidate.supportStatus` の分布

| supportStatus | 件数 |
|---|---|
| BEFORE（支援前） | 3,893 |
| ENDED（支援終了） | 268 |
| **ACTIVE（支援中）** | **102** |
| WAITING（待機） | 18 |
| ARCHIVED | 1 |
| 合計 | 4,282 |

### 5-2. ACTIVE の `supportSubStatus` 分布

| supportSubStatus | 件数 |
|---|---|
| 求人紹介 | 45 |
| 面接 | 25 |
| 書類選考 | 11 |
| 内定 | 10 |
| 求人紹介前 | 6 |
| エントリー | 4 |
| 入社済 | 1 |
| （null） | 0 |
| 合計 | 102 |

- ACTIVE のうち誕生日登録済み: **100**／面談記録あり＋誕生日あり: **100**

### 5-3. 有効な `JobEntry` を持つ求職者

`is_active` は `src/lib/entries/resolveEntryIsActive.ts:22-49` の判定結果が `job_entries.is_active`（schema.prisma:1805）に保存される。無効化トリガーは `src/constants/entry-flag-rules.ts`（実体は `src/lib/constants/entry-flag-rules.ts`）の `INACTIVE_TRIGGERS`（L48-53）＝ personFlag `見送り通知送信済`/`見送り通知済み`、companyFlag `辞退報告済`、および entryFlag `求人紹介`。**※変更禁止ファイルのため読むのみ。**

| 条件 | 求職者数（distinct） |
|---|---|
| `job_entries.is_active = true` を1件以上持つ | **195** |
| 　└ うち supportStatus=ACTIVE | **41** |
| 　└ うち supportStatus=BEFORE | 138 |
| 　└ うち supportStatus=ENDED | 15 |
| 　└ うち supportStatus=ARCHIVED | 1 |
| `is_active=true` かつ entryFlag∈(エントリー/書類選考/面接/内定/入社済) | 195（＝上と同数） |

- 最後の行が一致するのは、`resolveEntryIsActive` が entryFlag=`求人紹介` を無条件で `false` にするため（L33）。つまり **`is_active=true` は「求人紹介止まりでない実エントリー」と同義**。
- **要注意**: `is_active=true` を持つ求職者の **138名が supportStatus=BEFORE**。エントリーは動いているのに支援ステータスが更新されていない（あるいはサイト経由応募 route="site-apply" 由来）行が相当数ある。「いま選考が動いている求職者」を `supportStatus=ACTIVE` だけで切ると**この138名が漏れる**。

### 5-4. URL保有状況の実測（読み取り専用GETのみ・102名）

| 区分 | 件数 |
|---|---|
| ACTIVE 全体 | 102 |
| **URLあり（一覧化できる）** | **97** |
| URLなし（未発行） | 5 |
| API エラー | 0 |
| URL形式が `/v/{token}` に一致しない | 0 |
| token が求職者番号で始まらない | 0 |
| 期限が実質無期限（9999-12-31） | 78 |
| 期限が有限 | 19（**期限切れ0件・30日以内に切れるもの0件**。最も近い失効は 2026-09-21） |
| 一度もアクセスされていない | 2 |

- URLなし5名の内訳は **全員 supportSubStatus=`求人紹介前`**（＝まだ求人を案内していない＝URL未発行で正常）。

### 5-5. 絞り込み条件の推奨

| 案 | 条件 | 想定件数 |
|---|---|---|
| **A（推奨・まず出すなら）** | `supportStatus='ACTIVE'` | 102（うちURLあり97） |
| B | A ＋ `supportSubStatus <> '求人紹介前'` | 96 |
| C（選考実態ベース） | `is_active=true` の JobEntry を1件以上持つ | 195 |
| D（漏れ最小） | A ∪ C | 概算 256（102 + 195 − 41） |

「いま選考が動いている」の定義次第。CA の運用（URLを貼るのは面談後〜内定まで）に素直に合うのは **A**、選考実態に忠実なのは **D**。

---

## 6. 次段階で一覧を出力する場合の具体的な手順案

### 出力形式（CSV）

```csv
求職者番号,氏名,URL,最終アクセス日時
5008143,山田 太郎,https://mypage.bizstudio.co.jp/site/5008143-sf9hw0ww,2026/08/07 17:43
5008175,佐藤 花子,https://mypage.bizstudio.co.jp/site/5008175-mxchx5np,2026/07/23 23:16
```

- **URL列は `/site/{token}`**（CAが実際に貼るURL）。`/v/` は旧マイページなので出さない。
- **`admin=true&secret=...` 付きURLは絶対に出力しない**（secret 漏洩）。
- 最終アクセス日時は `last_accessed_at` を **UTC とみなして JST 変換**する（既存実装 `dashboard/route.ts:26-34` の `fmtJstDateTime` と同じ規約：末尾にTZが無ければ `Z` を付けてから `Asia/Tokyo` へ変換）。未アクセスは空欄。
- **CSV は PII を含むため verify/ 配下に置きリポジトリにはコミットしない**（既存 `verify/` の慣行どおり）。

### 手順（新規スクリプト `scripts/export-mypage-urls.ts` を追加する前提・実装は次プロンプト）

```bash
# 0) 実行環境: コンテナ側に DATABASE_URL と KYUUJIN_API_SECRET が揃っているため railway ssh 経由で実行する
#    （railway run は使わない＝ローカルの空DBに繋がるため）

# 1) スクリプトを base64 でコンテナへ渡して実行（読み取りのみ）
cd C:/bizstudio/bizstudio-portal
base64 -w0 scripts/export-mypage-urls.cjs > /tmp/x.b64
MSYS_NO_PATHCONV=1 railway ssh --service bizstudio-portal "echo $(cat /tmp/x.b64) | base64 -d | node" > verify/mypage-urls-20260807.csv

# 2) 件数検算（ACTIVE=102 / URLあり=97 と一致するか）
```

スクリプトの処理内容（擬似コード）:

```js
// SELECT のみ
SELECT candidate_number, name FROM candidates WHERE support_status = 'ACTIVE' ORDER BY candidate_number;

// 各件について読み取り専用GET（並列5）
GET {KYUUJIN_API_URL}/api/external/mypage/by-job-seeker/{candidate_number}  header: x-api-secret

// url が null なら「未発行」行として出す（発行はしない）
// url があれば token = url.match(/\/v\/([^/?#]+)/)[1]
//   → siteUrl = `https://mypage.bizstudio.co.jp/site/${token}`
// last_accessed_at → fmtJstDateTime 同等の変換
```

- **`POST /api/external/tokens/issue` は呼ばない**。未発行の5名は「未発行」と明記して出し、必要なら CA が個別に既存の「求人サイトURLを発行」ボタンを押す運用にする。
- 所要時間の目安: 102件・並列5で **1秒未満**（本調査で実測）。D案（約256件）でも2〜3秒。

### 将来的な productize（別チケット想定）

一回きりのCSVで足りなければ、`GET /api/candidates/export/mypage-urls`（セッション認証・CSVストリーム）を新設し、求職者一覧画面に「マイページURLを一括書き出し」ボタンを置くのが素直。ロジックは上記スクリプトと同一で、`by-job-seeker` を並列で叩くだけ。

---

## 7. 想定されるリスクと未確認事項

### リスク

| # | リスク | 深刻度 | 対策 |
|---|---|---|---|
| 1 | 発行API（`tokens/issue`）を誤って呼ぶと、期限切れトークン等で `warning` 経路に入る／新規発行が起きる | 高 | 一括書き出しは **GET `by-job-seeker` のみ**を使う。`scripts/issue-site-tokens-bulk.ts` は流用しない（あれは発行スクリプト） |
| 2 | `adminUrl`（`?admin=true&secret=...`）をCSVに混入させると **API secret が平文で流出** | 高 | 出力は `/site/{token}` のみ。`mypage/route.ts:62-64` の `adminUrl` は使わない |
| 3 | CSVが求職者番号＋氏名＋ログインURLを含む＝実質的な名簿 | 高 | `verify/` 配下に置きコミット禁止。共有はセキュアファイル送信（T-147）経由 |
| 4 | 旧マイページ `/v/` のURLをそのまま配ってしまう | 中 | 必ず `/site/` へ置換して出力。`/v/` は出力しない |
| 5 | `supportStatus=ACTIVE` で絞ると、BEFORE のまま選考が動いている138名が漏れる | 中 | 絞り込み条件を将幸さんに確認（5-5のA〜D案） |
| 6 | 有限期限トークン19件がいずれ失効し、書き出したURLが後日使えなくなる | 低 | CSVに `expires_at` 列を足すか、失効30日前を別途モニタする（現時点で期限切れ0・30日以内0） |
| 7 | 一括GETによる kyuujinPDF への負荷 | 低 | 並列5・102件で779ms。実害なし。並列は5を超えない |

### 未確認事項

1. **`/site/{token}` が全件でログイン可能かは未検証**。本調査では URL の文字列規則（token の同一性・形式一致97/97）と過去レポートの実測1件（`docs/reports/url-modal-open-button-and-template.md:36`）までを確認した。**書き出し後、1件だけ実際にブラウザで開いてログイン画面が出ることの確認を推奨**（発行を伴わないため安全）。
2. **kyuujinPDF 側にトークン一覧の読み取りAPIが存在するか**は、portal 側のコード・型定義からは確認できなかった。存在すれば1リクエストで済む可能性があるが、**kyuujin-pdf-tool リポジトリは本プロンプトの制約により未参照**。現状のループ方式でも性能上の問題は無い。
3. **`expires_at` の解釈**（UTC か JST か）は未確定。`9999-12-31T23:59:59` が大半のため実用上は影響しないが、有限期限19件を扱うなら要確認。`last_accessed_at` は既存実装が UTC 扱いなので同じ規約に揃えた。
4. **氏名の出典**は `candidates.name`（portal が source of truth）で問題ないが、旧姓・改姓の反映有無は未確認。
5. **URLなし5名（`求人紹介前`）**が「まだ発行していないだけ」なのか「発行後に失効・削除された」のかは、kyuujinPDF 側を見ないと区別できない。本調査では `url:null`（=アクティブなトークンなし）としか言えない。

---

## 8. 参照ファイル一覧

| ファイル | 行 | 内容 |
|---|---|---|
| `src/app/api/candidates/[candidateId]/mypage/route.ts` | 22-25, 31, 37-40, 61-71 | `/v/` URL取得（読み取り専用GET） |
| `src/app/api/candidates/[candidateId]/site-preview-url/route.ts` | 15-19, 72, 97-105 | 「新規発行しない」の明文化・トークン抽出 |
| `src/app/api/candidates/[candidateId]/issue-site-token/route.ts` | 5-11, 50-61, 79-84 | 発行系（今回は不使用） |
| `src/app/api/candidates/[candidateId]/dashboard/route.ts` | 26-34, 68-83 | `last_accessed_at` の JST 変換規約 |
| `src/lib/candidate-site/preview-url.ts` | 13-14, 82-86 | `/v/` と `/site/` の token が同一値である仕様 |
| `src/components/candidates/IssueSiteTokenButton.tsx` | 32-54, 108, 118 | 案内文テンプレ・URL埋め込み |
| `src/components/candidates/CandidateHeader.tsx` | 345-346 | ボタン設置箇所 |
| `src/components/candidates/CandidateDetailPage.tsx` | 1683-1686, 1781, 2013-2079 | 求人マイページモーダル |
| `src/lib/entries/resolveEntryIsActive.ts` | 22-49 | エントリー有効判定 |
| `src/lib/constants/entry-flag-rules.ts` | 48-53 | `INACTIVE_TRIGGERS`（★変更禁止・読むのみ） |
| `prisma/schema.prisma` | 453-554, 1805 | Candidate（token列なし）・JobEntry.is_active |
| `scripts/issue-site-tokens-bulk.ts` | 58-65, 220 | 既存の一括「発行」スクリプト（URL非出力・流用不可） |
| `docs/reports/T-128-token-rollout.md` | 11, 23, 79 | issue API の冪等性の実測記録 |
| `docs/reports/url-modal-open-button-and-template.md` | 36 | `/site/{token}` の実URL実測 |
