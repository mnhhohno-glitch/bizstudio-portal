# マイページ フラグ不整合・origin仕分けの全経路調査（高田 凌 / 5008152）

- 調査日: 2026-07-21（JST）
- 対象求職者: 高田 凌（candidateNumber `5008152` / Candidate.id `cmr2srwuf003k1dqlrq1k6t4v` / support_status=ACTIVE / media=マイナビエージェント / route=スカウト）
- 性質: **調査のみ。コード変更なし・DB書き込みなし・高田さんのデータ無変更。** 本番DBは SELECT のみ。
- 記法: 実測=「確定」、コード確認=「確定（コード）」、それ以外は「推測・未確認」と明記。日時はすべてJST。

---

## 0. 結論サマリ

| 症状 | 種別 | 白黒 |
|--|--|--|
| A: 自己検索応募が「担当CAおすすめ」タブに混入 | **仕分け欠落（コード）** | favorites API が origin で絞っていない。確定 |
| B: 本人の回答がCA側で見えない | **表示の問題（書き込みは出来ている）** | responseStatus は portal に書けている。CA画面がそれを表示していない。確定 |
| C: 応募済みが2タブに重複表示 + エントリー未生成 | **設計（別テーブル・重複許容）** | 応募した求人=CandidateJobApplication、応募したい=CandidateFile.responseStatus。別系統で重複。確定 |

**症状Bの白黒（最重要）**: 高田さんの回答（応募したい12・気になる3）は `CandidateFile.responseStatus` に**書き込まれている（APPLY=12・INTERESTED=3を実測）**。これは「書き込みの問題」ではなく**「表示の問題」**。CA画面（HistoryTab）は `CandidateFile.responseStatus` を一切fetch/表示しておらず、CA側が見ている「気になる/応募したい」チップは別テーブル `CandidateJobResponse`（高田さんでは**0件**）由来のため空になる。二重の表示ギャップ。

---

## 1. 高田さんの実データ突き合わせ表（すべて実測・確定）

### 1-1. CandidateFile 全量（47件）

| 軸 | 内訳 |
|--|--|
| category | BOOKMARK 41 / BS_DOCUMENT 4 / MEETING 2 |
| origin | null(=CA/システム) 33 / "candidate"(=本人サイト操作) 14 |
| responseStatus | null 31 / APPLY 12 / INTERESTED 3 / UNANSWERED 1 |

### 1-2. BOOKMARK 41件を origin × responseStatus で分解

| origin | responseStatus | 件数 | sourceType | externalJobRef | kyuujinJobId | aiMatchRating | 作成 |
|--|--|--|--|--|--|--|--|
| candidate | APPLY | 12 | job-platform | 有 | 無 | **null** | 7/18 15:05–21:19 |
| candidate | INTERESTED | 2 | job-platform | 有 | 無 | **null** | 7/18 21:14, 21:59 |
| ca(null) | INTERESTED | 1 | PDF(null) | 有 | 無 | 有 | 7/18 07:31 |
| ca(null) | UNANSWERED | 1 | PDF(null) | 有 | 有 | 有 | 7/18 07:29 |
| ca(null) | null | 25 | PDF(null) | 有 | 概ね有 | 概ね有 | 7/18 07:28–07:31 |

- origin=candidate 14件は**すべて** sourceType=job-platform・externalJobRef有・kyuujinJobId無・aiMatchRating null。
- responseSubmittedAt は**全41行でnull**（＝一度も「まとめ送信」していない）。実測・確定。

### 1-3. 他ストアの状態（実測）

| テーブル | 高田さんの件数 | 意味 |
|--|--|--|
| candidate_response_submissions（まとめ送信） | **0** | 一度もまとめ送信していない |
| candidate_job_responses（旧・求人別回答／CAチップの表示元） | **0** | CA側チップが空になる直接原因 |
| job_entries（エントリー管理） | **0** | 自己応募はエントリー管理に載っていない |
| candidate_job_applications（「応募した求人」タブの表示元） | **8** | circus×3 / hl-ap×5、7/18 15:07–21:19 |

### 1-4. マイページ「担当CAおすすめ」タブ表示件数の再現（実測で一致）

観測値: 未回答26・気になる3・応募したい12・保留0・対象外0。

BOOKMARK 41件を `normStatus`（null→UNANSWERED畳み込み）で集計すると:
- 応募したい(APPLY)=12 ✓
- 気になる(INTERESTED)=3 ✓（candidate 2 + ca 1）
- 未回答(UNANSWERED + null)=1 + 25 = **26** ✓
- 保留(PENDING)=0 ✓ / 対象外(EXCLUDED)=0 ✓

→ **41件（BOOKMARK全件）= 26+3+12。origin無視で全件を出していることの実測的裏付け。**

### 1-5. 応募済みの2タブ重複（症状C）

- 応募したい(CandidateFile responseStatus=APPLY)=12件
- 応募した求人(CandidateJobApplication)=8件
- うち **8件は externalJobRef 一致**＝同一求人が「担当CAおすすめ(応募したい)」と「応募した求人(応募済み)」の両方に出る。実測・確定。
- 残り4件は「応募したい」だが応募レコード無し（本人が仕分けonly・未応募 と推測）。

---

## 2. 症状ごとの発生点（コード・データ根拠つき）

### 症状A: 自己検索の応募が「担当CAおすすめ」タブに出る → 仕分け欠落（確定・コード）

- 表示元 portal API: `GET /api/external/candidate-site/favorites`
  - `src/app/api/external/candidate-site/favorites/route.ts:127-155` の where は
    `{ candidateId, category: "BOOKMARK", archivedAt: null }` の**3条件のみ**。**origin 述語なし**。
    行頭コメント(:126)も「全ブックマーク（CA追加・本人追加・旧PDF経路すべて）を…取得」と明言。
  - `origin` は select して返しているが（:177 `origin: f.origin === "candidate" ? "candidate" : "ca"`）、**絞り込みには使っていない**。
- mypage 側 `CaRecommendPanel.tsx:764-765` はタブ内可視行を `responseStatus`（statusOf）だけで絞る。origin では絞らない。
- 「自分で追加」バッジ: `CaRecommendPanel.tsx:193-202` で `origin==="ca" → 担当CAおすすめ / それ以外 → 自分で追加`。**バッジは出し分けるが、行自体は同じタブに同居**。
- 実データ: 高田さんは self-search 14行（APPLY12・INTERESTED2）がそのまま担当CAおすすめタブに乗る。1-4で件数一致。

→ **仮説「タブは origin を見ておらず CandidateFile 全件を出している」は正しい。確定。**

### 症状B: 本人の回答がCA側で見えない → 「表示の問題」（書き込みは出来ている）。確定

**(a) 書き込み側 = 出来ている（実測）**
- 高田さんの self-search 行の `responseStatus` は APPLY=12・INTERESTED=2 が**実際に入っている**。
- 書き込み経路（新マイページ）: `PATCH /api/external/candidate-site/response-status`
  `response-status/route.ts:119-129` が既存 CandidateFile 行の `responseStatus` と `responseStatusUpdatedAt` を**更新する**（fileId優先・無ければkyuujinJobIdで対象行特定）。
- → **7/16 の旧 `/v` webhook と同種の「書き込み欠落」ではない。新マイページの仕分けは responseStatus を portal に書けている。**

**(b) 表示側 = CA画面が responseStatus を出していない（確定・コード）**
- CA一覧の files API `src/app/api/candidates/[candidateId]/files/route.ts:69-104` の select に **`responseStatus` が無い**（origin・aiMatchRating・aiAnalysisComment 等は返すが responseStatus は返さない）。
- `HistoryTab.tsx` 全体で `responseStatus` を**一度も参照していない**（grep 済み。responseStatus の利用は `/site/` 系 external API・dashboard集計・sync/notify libのみ）。
- CA画面に出る「気になる/応募したい」チップは**別フィールド** `CandidateJobResponse.response`（`candidate_response`）由来:
  - `HistoryTab.tsx:31-34` の RESPONSE_BADGE は `WANT_TO_APPLY`/`INTERESTED` の2値のみ。
  - `jobs/route.ts:81-108` が `candidateJobResponse` を join して `candidate_response` を供給。
- 高田さんの `candidate_job_responses` は**0件**（1-3）。理由: 新 sort PATCH は `kyuujinJobId != null` の時だけ CandidateJobResponse に同期する（`response-status/route.ts:136`）が、高田さんの self-search 行は **kyuujinJobId=null（job-platform）** のため同期されない。
- → **二重の表示ギャップ**: ①CA画面は CandidateFile.responseStatus を表示しない。②CA画面が見る CandidateJobResponse は job-platform 行では空。結果、本人の回答がCAから完全に見えない。

**(c) 希望・通過・総合「—」の原因（別issue・確定）**
- `HistoryTab.tsx:398-405 parse3AxisRatings` が `aiAnalysisComment` の「■本人希望/■通過率/■総合」から A–D を抜く。総合は `file.aiMatchRating` フォールバック（:1459）。＝**AIマッチ評価（A–D）**であって responseStatus とは無関係。
- 高田さんの self-search（サイト経由）行は **aiMatchRating=null・aiAnalysisComment=null**（14/14）。AIマッチ解析は CA投入PDF（extractedText有）に対して走り、job-platform 自己検索ブックマークには走らないため。
- → サイト経由行の希望/通過/総合「—」は**評価未実施**が原因（表示バグではない）。CA投入PDF行25件には A–D が付いている（A11/B9/C3/D2、実測）。

### 症状C: 応募済みとタブ件数の食い違い → 設計（別テーブル・重複許容）。確定

- 「応募した求人」タブ = `GET /api/external/candidate-site/applications` → **`CandidateJobApplication`** テーブル（`applications/route.ts:52-56`）。responseStatus でも CandidateJobResponse でも JobEntry でもない。
- 応募POST `apply/route.ts:63-66` が `CandidateJobApplication` を作る。**responseStatus は触らない。**
- 「応募したい」フラグ（担当CAおすすめタブ）= `CandidateFile.responseStatus=APPLY`。別テーブル・別目的で**重複排除していない**。→ 同一求人が両タブに出る（高田さん8件重複、実測）。
- 自己応募は `JobEntry`（エントリー管理）に**作られない**（高田さん0件）。CAのエントリー管理ボードには自己応募が現れない。CA実務フロー（エントリー登録）には自動では乗らない。

---

## 3. マイページ各タブ・各フラグの抽出条件（実コード引用）

| 面 | エンドポイント / テーブル | 抽出条件 |
|--|--|--|
| 担当CAおすすめ タブ | `candidate-site/favorites` → CandidateFile | `where {candidateId, category:"BOOKMARK", archivedAt:null}`。**origin絞りなし**。実候補者では EXCLUDED のみ mypage BFF で除外（`site/favorites/route.ts:227-231`） |
| フラグ件数 | client集計（`CaRecommendPanel.tsx:615-632`）over `responseStatus` | `normStatus`（`ca-status.ts:82-88`）で **null/unknown→UNANSWERED**。未回答=UNANSWERED(+null)/気になる=INTERESTED/応募したい=APPLY/保留=PENDING/対象外=EXCLUDED |
| 応募した求人 タブ | `candidate-site/applications` → **CandidateJobApplication** | apply POST が作る行。responseStatus/CandidateJobResponse とは独立 |
| 自分で追加 バッジ | `CandidateFile.origin` | `origin==="ca"→担当CAおすすめ / else→自分で追加`（`CaRecommendPanel.tsx:193-202`） |

canonical な responseStatus 値定義: `src/lib/constants/response-status.ts:3-11`。

---

## 4. CA画面に responseStatus を表示する列の有無

**無し（確定）。** CA files API は responseStatus を select せず、`HistoryTab.tsx` も参照しない。
- CA側 BOOKMARK テーブルの実列: `checkbox | DB名 | DBNO | 会社名(+気になる/応募したいチップ +出力済チップ) | 希望 | 通過 | 総合 | 担当 | 紹介日 | DL/操作`（`HistoryTab.tsx:1339-1371`）。
- 「気になる/応募したい」チップ = `CandidateJobResponse.response`（別フィールド、2値のみ）。CandidateFile.responseStatus（UNANSWERED/APPLY/PENDING/EXCLUDED/IN_SELECTION/…）は**どの列・バッジにも出ない**。
- 「担当」列: `origin==="candidate"→「サイト経由」/ else→uploadedBy.name`（`HistoryTab.tsx:1460-1467`）。＝背景の「登録者=サイト経由」。

---

## 5. 影響範囲（Step 3・実測）

| 指標 | 値 |
|--|--|
| origin=candidate 行を持つ ACTIVE 求職者 | **29名 / 163行**（全て BOOKMARK＝全て担当CAおすすめタブに混入） |
| うち responseStatus が入った（回答済み）origin=candidate 行 | **155行**（INTERESTED 92 / APPLY 63）/ 29名 → 全員が高田さんと同じく **CA側で見えない** |
| origin=candidate 行の aiMatchRating null 率（ACTIVE） | **162/163 が null**（サイト経由行はほぼ全て希望/通過/総合「—」） |
| 応募した求人（CandidateJobApplication）ACTIVE | 9名 / 33行 |
| 旧webhook由来の乖離（CandidateJobResponse有×対応CandidateFile.responseStatusが不一致/null・ACTIVE） | **96行 / 24名** ＝二つの回答ストアが食い違っている件数 |
| 参考: CandidateJobResponse 総数（ACTIVE・CAチップの表示元） | 588行 / 82名 |

→ **高田さん個別ではなく systemic**。担当CAおすすめタブ混入=29名、CA側で回答不可視=29名/155行、回答ストア乖離=24名/96行。

---

## 6. 修正の設計材料（提案のみ・実装しない）

### 6-1. タブ仕分けの推奨案
- **A案（最小・portal）**: `favorites` API に origin フィルタを追加し、担当CAおすすめタブは `origin!="candidate"` のみ返す。self-search 行は別エンドポイント/タブへ。
- **B案（mypage側）**: favorites は全件返しのまま、mypage `CaRecommendPanel` で origin により表示セクションを分離（新タブ「自分で探した求人」等）。
- いずれでも、self-search の「気になる/応募したい」を候補者本人がどこで見るかの受け皿タブが必要（消さない）。EXCLUDED除外・displayOrder・pickup は維持前提。

### 6-2. 回答のCA側表示の推奨案（症状Bの本丸）
- **表示修正（必須）**: CA files API に `responseStatus` を select 追加 → `HistoryTab` に responseStatus 列/バッジ追加（UNANSWERED/INTERESTED/APPLY/PENDING/EXCLUDED 対応）。これで高田さん含む155行が可視化。低リスク（表示のみ）。
- **書き込みギャップ修正（別本・要注意）**: 旧webhook `candidate-response` → `ensureBookmarkForMypageResponse`（`mypage-response-sync.ts:336-393`）は**create-only**で既存行を更新しない。既存BOOKMARK行の responseStatus を更新する upsert 化を検討（乖離96行の主因の一つ）。冪等性・7/16対処との整合に注意。

### 6-3. 修正の分割案（依存順）
1. **portal #1（表示）**: CA files API select + HistoryTab に responseStatus 列。独立・低リスク。→ 症状Bの体感解消。
2. **portal #2 + mypage（仕分け）**: favorites の origin 仕分け or mypage タブ分離。portal と mypage 対で1組。→ 症状A解消。
3. **portal #3（書き込みギャップ）**: 旧webhook の既存行 responseStatus 更新化。独立・中リスク。→ 乖離解消。
4. （任意）症状C: 「応募したい」と「応募済み」の重複表示の扱い（応募済みは応募したいから除外表示する等）は mypage 表示調整で対応可。エントリー未生成は別途「自己応募→エントリー化」フロー要否をCA運用と相談。

規模感（推測）: #1 小（1〜2ファイル）/ #2 中（portal 1 + mypage 1〜2）/ #3 小〜中（1ファイル + 回帰確認）。

### 6-4. 修正時に壊してはいけないもの
- ピックアップ（`pickedUpAt` 上限3件/求職者）・`displayOrder` 手動並び順。
- AIマッチ評価表示（希望/通過/総合＝`aiAnalysisComment`/`aiMatchRating`）。
- 7/16以降の修正群: `ensureBookmarkForMypageResponse` の冪等性、mypage BFF の EXCLUDED 除外、未送信検知（`responseSubmittedAt=null` を pending とみなす判定：`favorites/route.ts:57-66`・`response-submission/route.ts:63-67`）。
- `caComment` の表示（origin=ca 時のみ）・「サイト経由」担当列表示（origin=candidate）。
- CandidateJobResponse ↔ CandidateFile の既存同期（`kyuujinJobId != null` 時）。

---

## 7. 想定と違った点

1. **「応募した求人」タブは CandidateFile でも CandidateJobResponse でも JobEntry でもなく、専用テーブル `CandidateJobApplication` を読んでいた**（事前の既知事実リストに無い第3の応募ストア）。
2. **CA側の「気になる/応募したい」チップは CandidateFile.responseStatus ではなく別テーブル CandidateJobResponse 由来**。そのため responseStatus を書けていてもCAに出ない、という二重ギャップだった。
3. 症状B は「書き込みか表示か」で**表示**が主因だが、`kyuujinJobId=null`（job-platform 自己検索行）では CandidateJobResponse 同期もされないため、CA側チップが構造的に空という**二段構え**だった。
4. 希望/通過/総合「—」は表示バグではなく、self-search 行に AIマッチ評価（aiMatchRating/aiAnalysisComment）が**そもそも無い**ため（CA投入PDF行には A–D 有）。
5. 旧webhook の write-gap（既存行未更新）は関数追加後も**残存**（create-only）。ACTIVE で96行/24名の乖離として観測。

---

## 8. 無変更・無書き込みの確認

- コードは1行も変更していない（報告書ファイルのみ）。`git status` でコード差分ゼロを確認済み。
- 本番DBは SELECT のみ。INSERT/UPDATE/DELETE・スキーマ変更なし。
- 高田さん（5008152）の Candidate・CandidateFile・その他レコードを一切変更していない。
- AI（Gemini/Claude）を呼ぶ処理は実行も追加もしていない（費用¥0）。
- job-platform（Supabase）側DBは本調査では接続・参照していない（portal側で症状の発生点が確定したため）。externalJobRef の接頭辞（circus-/hl-ap-）から媒体は circus・HITO-Link と読めるが、job-platform 内テーブル構造は未確認。
