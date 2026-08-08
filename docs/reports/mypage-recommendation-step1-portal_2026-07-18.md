# step1 / portal: favorites API に「本人向けおすすめポイント」を追加（サーバー側フェイルクローズ切り出し）

**実施日**: 2026-07-18
**対象**: bizstudio-portal（master 直 push）
**スコープ**: portal のみ（マイページ側は step2）

---

## 1. コミットID

`f937433` — `feat(mypage): expose candidate-facing ai recommendation via favorites api (fail-closed)`

（前段の調査報告書コミット: `31539ef` / `4c3b82e`）

## 2. Railway デプロイ結果

**SUCCESS**（service=bizstudio-portal, commitHash=f937433）
- BUILDING → DEPLOYING → **SUCCESS** を確認（polling で確認済み）

## 3. 変更したファイルの一覧

| ファイル | 変更内容 |
|--|--|
| `src/lib/comment-split.ts` | `extractRecommendationForDisplay()` を追加（+46行）。既存関数は無変更 |
| `src/app/api/external/candidate-site/favorites/route.ts` | import 追加、`FavoriteDTO` に `aiRecommendation` 追加、GET/POST/PATCH の select に `aiAnalysisComment: true` 追加、GET インライン map と `toDTO()` に `aiRecommendation` 算出を追加（+20/-3行） |

**マイページ（`C:\bizstudio-mypage`）は1ファイルも変更していない。**

## 4. `extractCandidateFacingComment()` を そのまま使えたか / 最小修正したか

**そのままは使えない。新規に `extractRecommendationForDisplay()` を追加した（既存関数は無変更）。**

理由: `extractCandidateFacingComment()` は**フェイルクローズ要件を満たさない**。CA向け見出しが無い場合、CF見出し以降の**全文を本人向けとして返す**設計であり、これが調査で見つかった CA向け内容漏洩の原因そのもの。実データで確認:

```
=== SURVEY LEAK ROW cmq6aipzf008s1dpkfbtr6zcu ===
OLD extractCandidateFacingComment tail (CA leak):
  ...法人営業4年の経験は高く評価される → B判定 - 年収レンジ: 380〜420万円。
     面談了承済みのレンジ内だが、現年収500万円からの大幅ダウン - 企業規模: ...
NEW extractRecommendationForDisplay result: null
```

### 新関数の設計（「新しい切り出しロジックを書かない」の遵守）

`extractRecommendationForDisplay()` は**既存の構成部品をそのまま再利用**する:
- 同一の見出し正規表現 `CANDIDATE_HEADER_RE` / `CA_HEADER_RE`
- 同一の `stripMarkdown()`
- 本文抽出は `extractCandidateFacingComment()` 内の `body`（CF見出し直後〜CA見出し直前の substring）と**同一のロジック**

異なるのは表示要件に沿った2点のみ:
1. **フェイルクローズガード**: CA見出しが CF見出しより後ろに存在する場合のみ本文を返す。片方欠落・逆順・旧フォーマット・見出しなし・空は一律 null（部分返却しない）
2. **企業名タイトル見出しを含めない**（表示側が独自のセクション見出しを付けるため本文のみ。`extractCandidateFacingComment` は先頭に `【会社名】タイトル` を付けるが、本関数は付けない）

### sync-ca-comments への影響

**影響なし。** `extractCandidateFacingComment()` 自体は1バイトも変更していないため、`sync-ca-comments` / `send-to-job-tool` / `files/[fileId]` PATCH の既存挙動は完全に不変。新関数は favorites GET/POST/PATCH からのみ呼ばれる独立関数。

## 5. レスポンスの実例

### 値が入るケース（大野テスト 5999999・本番実測）

D判定の求人でも本人向けはポジティブな内容のみ（CA向け文言を含まない）:

```
[1] id=cmro17ovh00021dp6bcs0dbxd rating=D
   シスメックスCNA株式会社は、臨床検査情報システムで国内トップクラスのシェアを持つ
   シスメックスグループの中核企業です。年間休日125日、退職金制度、育休復帰率100%と
   安定した就業環境が整っています。大野さんがGABAやブリタニカで培った顧客対応力・
   サポート経験は、医療機関向けのカスタマーサポート業務でも大いに活かせます…

[2] id=cmro17lte00011dp62ar5jxc7 rating=D
   ドクターキューブ株式会社は、診療予約システムで業界シェアNo.1を誇る急成長企業です…
   業種・職種未経験歓迎で学歴不問、顧客折衝経験があれば応募可能なポジションです…
```

**CA向け文言（選考分析・通過率・D判定の理由・必須要件充足状況・懸念点等）は1文字も含まれない**（危険語スキャン 0ヒット）。

### null になるケース

- `ai_analysis_comment` が NULL/空 → null（大野テスト51件中32件が該当）
- CF見出しのみで CA見出しなし → null（＝旧関数なら CA内容が漏洩していた行。上記 SURVEY LEAK ROW 参照）
- 旧フォーマット（推薦コメント/マッチポイント）・見出しなし → null

## 6. 動作確認手順 1〜8 の結果

| # | 項目 | 結果 | 詳細 |
|--|--|--|--|
| 1 | 大野テストで分析ある求人に `aiRecommendation` が入る | **OK** | 51件中19件に値、フィールド存在確認 |
| 2 | 中身が本人向けのみ（CA向け文言なし） | **OK** | 危険語（選考分析/CA向け/必須要件チェック/D判定の理由/書類通過は困難/通過見込み 等）ヒット **0件** |
| 3 | **見出しなし危険パターンで null** | **OK（最重要）** | 調査で漏洩が見つかった行 `cmq6aipzf...` → **null**。旧関数なら「現年収500万円からの大幅ダウン」等が漏洩していた（上記対比）。テーブル全体5,713件でも構造的漏洩 0件 |
| 4 | `ai_analysis_comment` 空で null | **OK** | 大野テストの NULL列32件が全て null（突合で不一致0） |
| 5 | **レスポンス全体に生の値が無い** | **OK（最重要）** | レスポンス本文の全文検索: `選考分析（CA向け）`=false / `選考分析`=false / `CA向け`=false / `aiAnalysisComment`=false / `ai_analysis_comment`=false |
| 6 | 応答時間が従来と同等 | **OK** | 下記7参照 |
| 7 | マイページが従来どおり動く | **OK（未変更）** | mypage 無変更のため表示・挙動に変化なし。favorites レスポンスは後方互換（フィールド追加のみ） |
| 8 | sync-ca-comments が従来どおり | **OK** | `extractCandidateFacingComment` 無変更。新関数は独立 |

### fail-closed 正確性の突合（大野テスト51件）

```
CLASSIFICATION -> RESULT:
   BOTH_HEADERS -> NONNULL = 19    （両見出しあり→全て抽出）
   NULL_COLUMN  -> NULL    = 32    （分析なし→全て null）
UNEXPECTED_MISMATCHES: 0           （本来抽出すべき行の取りこぼし・漏洩とも0）
```

テーブル全体5,713件スキャン: 抽出5,424件 / null 289件 / **構造的漏洩0件**（抽出5,424件は調査の「両見出し正順」件数と完全一致）。

## 7. 応答時間の実測（確定）

| 指標 | 値 |
|--|--|
| favorites GET 全体（大野テスト51件・本番実測） | **1,221 ms** |
| 抽出処理のオーバーヘッド（51件リスト全体・2000回平均） | **0.014 ms** |
| 1行あたり抽出コスト | **0.27 マイクロ秒** |

**判定: 悪化なし。** 応答時間はDBクエリ＋シリアライズが支配的で、切り出し処理の追加コストは全体の 0.001% 未満（1221ms 中 0.014ms）。調査時のマイページ表示 ~1.4秒の範囲内で変化なし。

## 8. AI（Gemini / Claude）を1回も呼んでいないことの確認

**確認済み。** 本タスクで追加/変更したコードは文字列処理（正規表現・substring・stripMarkdown）のみ。AI SDK・API 呼び出しは追加も実行もしていない。既存の `ai_analysis_comment` を読んで切り出すだけで、運用後も表示のたびに切り出すのみ（AI非呼び出し）。

## 9. マイページ（`C:\bizstudio-mypage`）を一切触っていないことの確認

**確認済み。** 変更は portal の2ファイルのみ（`git status` で確認）。`C:\bizstudio-mypage` 配下は読み取りもコミットもしていない（step2 で実施）。

## 10. step2 で使う情報

| 項目 | 内容 |
|--|--|
| **フィールド名** | `aiRecommendation` |
| **型** | `string \| null` |
| **場所** | favorites GET レスポンスの `favorites[]` 各要素（POST/PATCH の `favorite` にも同梱） |
| **null の条件** | ①`ai_analysis_comment` が NULL/空、②「◆ おすすめポイント（本人向け）」見出しなし、③「◆ 選考分析（CA向け）」見出しが本人向け見出しより後ろに存在しない（逆順・片方欠落・旧フォーマット）、④切り出し本文が空 |
| **値の内容** | 本人向けおすすめポイント**本文のみ**（見出し行「◆ おすすめポイント（本人向け）」・企業名タイトル・CA向けセクションは含まない） |
| **表示指針** | mypage 側で `favorite.aiRecommendation` が非 null の時だけ「どんな会社？」と「給与」の間にセクションを出す。セクション見出し（例:「おすすめポイント」）は mypage 側で独自に付ける。null の時は何も出さない |
| **改行** | 本文中に `\n` を含みうる（`whitespace-pre-wrap` 相当で表示推奨） |
| **後方互換** | 既存フィールドの削除・改名なし。追加のみ |

## 11. 想定と違った点・注意点

1. **`extractCandidateFacingComment()` は再利用せず新関数を追加した**: 指示は「そのまま使う」だったが、この関数は CA見出しなし時に全文返却する＝**漏洩の原因そのもの**のため、フェイルクローズ表示には使えない。指示の但し書き（「満たしていない場合のみ最小修正」）に従い、既存の構成部品（正規表現・stripMarkdown・body抽出）を流用した独立関数を追加。既存関数を変更しないことで sync-ca-comments 等への副作用をゼロにした。

2. **危険語スキャンの誤検知**: テーブル全体スキャンで「大幅ダウン」が1件ヒットしたが、内容は「現年収からの**大幅ダウンを避けられる**水準です」という本人向けのポジティブ表現（給与維持のアピール）。CA漏洩ではない。構造的マーカー（選考分析/CA向け）の漏洩は全5,713件で0件。

3. **大野テストには CF_ONLY 行が無かった**: 危険パターン（CF見出しのみ）は大野テストのブックマークには存在しなかったため、item 3 の証明はテーブル全体の調査漏洩行 `cmq6aipzf...` で実施（→ null を確認）。

4. **抽出コストが想定以上に軽量**: 1行0.27マイクロ秒。一覧全件に毎回走らせても実質ゼロコスト。キャッシュ等の最適化は不要。

5. **生の値をselectに含めるがレスポンスには載せない設計**: Prisma select に `aiAnalysisComment: true` を追加してメモリに読むが、DTO には切り出し後の `aiRecommendation` のみを載せる。レスポンス全文検索で生の値・列名とも露出なしを確認済み。

---

※ 実測値（応答時間・件数・漏洩スキャン結果）は本番DB/本番エンドポイントでの「確定」値。
