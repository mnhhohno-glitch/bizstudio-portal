# T-128 完了報告：candidate-site 面談由来 希望条件エンドポイント追加

実施日: 2026-07-02 ／ 対象: bizstudio-portal（本番=master）
種別: 読み取り専用の新規エンドポイント1本追加（既存不変・DBスキーマ変更なし）

---

## 1. エンドポイント仕様

```
GET /api/external/candidate-site/preferences?candidateNumber=5999999
（または ?candidateId=<cuid>）
```

- **認可**: `X-Auth-Key: <CANDIDATE_SITE_API_KEY>`（T2 と同一・fail-closed）。未設定/欠落/不一致は全 **401**（timingSafeEqual）。
- **候補者解決**: T2 の `resolveScopedCandidate`（candidateId 優先・無ければ candidateNumber）。存在しなければ **404**。
- **スコープ**: 解決済み候補者IDを全クエリ条件に固定。他候補者のデータは返らない。
- **返す内容（ホワイトリスト）**: その候補者の**希望条件を持つ最新面談**の InterviewDetail から、希望職種・希望勤務地(都道府県)・希望年収(下限/上限)＋出典メタ(面談日)のみ。
- **変換なし**: 保存されている名称のまま素の値を返す（job-platform 検索パラメータへのマッピングは mypage 側 seed 関数の責務）。
- **希望条件なし**: 200 で `hasPreferences:false`（**404にしない**。mypage のフォールバック判定用）。

### レスポンス形

**希望条件あり**:
```json
{
  "ok": true,
  "candidateNumber": "5008108",
  "hasPreferences": true,
  "preferences": {
    "desiredJobTypes": [
      "医薬・食品・化学・素材 / 医薬品・医療機器 / 研究(ゲノム・バイオ)",
      "医薬・食品・化学・素材 / 化学・素材・バイオ / 品質管理・保証(化学・素材・バイオ系)"
    ],
    "desiredPrefectures": ["東京都"],
    "desiredSalaryMin": 350,
    "desiredSalaryMax": 400
  },
  "source": { "interviewDate": "2026-07-03" }
}
```

**希望条件なし**:
```json
{
  "ok": true,
  "candidateNumber": "5999999",
  "hasPreferences": false,
  "preferences": null,
  "source": null
}
```

### フィールド定義
| フィールド | 型 | 内容 |
|---|---|---|
| `preferences.desiredJobTypes` | string[] | 希望職種（`desiredJobType1`,`desiredJobType2` を非空・重複除去）。"大 / 中 / 小" の "/"区切り名称そのまま。複数可 |
| `preferences.desiredPrefectures` | string[] | 希望都道府県（`desiredAreas` JSON の prefecture を優先抽出＋`desiredPrefecture` を統合・重複除去）。複数可 |
| `preferences.desiredSalaryMin` | number\|null | 希望年収下限（万円・整数） |
| `preferences.desiredSalaryMax` | number\|null | 希望年収上限（万円・整数） |
| `source.interviewDate` | string | 採用した面談日（YYYY-MM-DD）。いつ時点の希望かの出典 |

### hasPreferences 判定
- 候補者スコープの面談を `interviewDate` 降順で走査し、**希望職種・都道府県・年収(下限/上限)のいずれかが入っている最新の面談**を採用。
- 最新面談に希望条件が無くても、より古い面談にあれば seed として有用なためそれを採用（採用面談日を `source.interviewDate` で明示）。
- どの面談にも希望条件が無い（または面談Detailが無い）→ `hasPreferences:false`。

---

## 2. 検証結果（ローカル dev + 共有本番DB・読み取りのみ）

検証は一時キーを inline で設定した dev サーバー（.env は非変更）で本番DBに対し実施。全て GET（読み取り）。

| # | 検証項目 | 結果 |
|---|---|---|
| 1 | 認可: no-key / wrong-key | **401 / 401** ✓ |
| 1 | 認可: 正キー | **200** ✓ |
| 2 | 実候補者(5008108・希望条件あり) | 構造化値が返る（職種2件・都道府県・年収350〜400・面談日） ✓ |
| 3a | テスト候補者(5999999・面談Detailなし) | **hasPreferences:false** ✓ |
| 3b | 希望条件なし候補者(5000717) | **hasPreferences:false** ✓ |
| 4 | 存在しない候補者番号(0000000) | **404** ✓ |
| 5 | 全キー走査（許可フィールド以外の混入なし） | トップ/preferences/source すべて許可キーのみ・禁止語(面談ログ/退職理由/所感/評価等)の混入 **なし** ✓ |
| 6 | すり替え拒否（各番号が自分のデータのみ） | 5008108/5000717/5999999 いずれも要求番号=応答番号で一致 ✓ |
| 7 | 本番ビルド（next build・スクラッチ除外） | **成功** ✓ |

- 実データの値は上記レスポンス例に含む（本人希望のマスク対象ではない業務データ・候補者番号は検証用）。
- ホワイトリスト実装: InterviewRecord/InterviewDetail の select で希望条件フィールドのみ取得。面談ログ本文(`interviewMemo`/`summaryText`/`rawTranscript`)・退職理由・所感・評価は select していない（コードレベルで到達不能）。

---

## 3. コミット・push・デプロイ

- コミット: `feat(candidate-site): expose interview-derived preferences for recommendation seed`
- add 対象（パス明示・`git add -A` 不使用）:
  - `src/app/api/external/candidate-site/preferences/route.ts`（新規）
  - `docs/reports/T-128-preferences-endpoint.md`（本報告）
  - `docs/reports/survey-ai-advisor-conditions.md`（先行調査・seed根拠）
- （コミットID・push・Railwayデプロイ結果は本文末尾に追記）

---

## 4. mypage（T4第2弾）向け接続情報

- ベースURL: `https://bizstudio-portal-production.up.railway.app`
- ヘッダ: `X-Auth-Key: <CANDIDATE_SITE_API_KEY>`（T2 と同一キー。既に本番設定済み）
- 呼び出し: `GET /api/external/candidate-site/preferences?candidateNumber=<番号>`
- **seed 2段化ロジック（mypage側）**:
  1. 本エンドポイントを叩く。
  2. `hasPreferences:true` → `preferences` を seed に「条件が近い求人」検索（職種・都道府県・年収を job-platform 検索パラメータに mypage 側でマッピング）。
  3. `hasPreferences:false` → CAおすすめ類似（既存ブックマーク属性 seed）にフォールバック。
- 注意: `desiredJobTypes` は "大 / 中 / 小" の日本語 "/"区切り名称。mypage 側で split して職種マスタ照合が必要。`desiredSalaryMin/Max` は万円単位の整数。

---

## 5. 制約・設計メモ
- 変換ロジックは portal に置かない（素の値のみ返す）。job-platform パラメータ化は mypage seed 関数の責務。
- DBスキーマ変更なし・既存エンドポイント不変・読み取り専用。
- 認可キー未設定環境（staging 等）は fail-closed で全 401（意図どおり）。
