# T-131 追撃: portal媒体判定にマイナビ形式追加＋本物マイナビPDFでの会社名検証

**日付**: 2026-07-04 / **対象**: bizstudio-portal (master)

---

## 修正1: detectMediaFromFilename にマイナビ形式追加

### 判定順の転記（修正後）

`src/lib/job-platform-ingest.ts` の `detectMediaFromFilename`:

```ts
export function detectMediaFromFilename(fileName: string): "circus" | "mynavi_jobshare" | "own" {
  const f = fileName ?? "";
  if (/No\d{5,7}/i.test(f)) return "circus";         // 1. Circus: No + 5〜7桁
  if (/^\d{4,6}_/.test(f)) return "mynavi_jobshare";  // 2. マイナビJOB: 先頭4〜6桁 + _
  return "own";                                        // 3. その他
}
```

**判定順の根拠**: circus判定（`/No\d{5,7}/i`）はファイル名中の任意位置にマッチ、mynavi判定（`/^\d{4,6}_/`）は先頭のみ。仮に先頭が数字でかつ`No`パターンも含む場合（例: `12345_会社_No123456.pdf`）は circus が先勝ち。実データ上の衝突ケースは0件。

### 誤マッチ照合

全ブックマーク4,324件中、`/^\d{4,6}_/` にマッチするファイル: **90件**。

全件がマイナビJOB形式（`数字ID_会社名_求人タイトル.pdf`）であることを目視確認。代表例:

| ファイル名 | 実際の媒体 | 判定 |
|---|---|---|
| `33636_株式会社富士薬品_全国募集【ルート営業】未経験歓迎.pdf` | マイナビJOB | mynavi_jobshare |
| `19604_株式会社リクルートスタッフィング【キャリアウィンク事業部】_….pdf` | マイナビJOB | mynavi_jobshare |
| `28251_株式会社ヨコオ.pdf` | マイナビJOB | mynavi_jobshare |
| `22498_マンパワーグループ株式会社【東日本営業本部】_….pdf` | マイナビJOB | mynavi_jobshare |

Bee/Circus/own の既存ファイル名が `^\d{4,6}_` に誤マッチするケース: **0件**。

- Circus: `会社名_No\d{5,7}.pdf` 形式（先頭は会社名）→ 衝突しない
- HITO-Link (job-platform): `求人票_会社名.pdf` 形式 → 衝突しない
- Bee: DB内にBee由来ブックマーク0件（確認不可・パターン上は会社名始まりのため衝突想定なし）
- own: `求人票_…` / `会社名：番号.pdf` 等 → 衝突しない

**判定順の調整・正規表現の厳密化: 不要**（誤マッチ0件）。

### media_sources 整合

job-platform の `media_sources` テーブル（PK=code）:

| code | display_name | is_active |
|---|---|---|
| `hito_link` | HITO-Link | true |
| `circus` | Circus | false |
| `mynavi_jobshare` | マイナビJOBシェアリング | false |
| `bee` | Bee | false |
| `own` | 自社 | true |

`mynavi_jobshare` は登録済み。portal から送信する値とDBのPKが一致。

### 追加修正: source-media.ts キー修正

`src/lib/constants/source-media.ts` の `SOURCE_MEDIA_TO_JOBDB` マッピングキーが `mynavi_job_sharing` だったが、job-platform 側の実値は `mynavi_jobshare`。キーを修正:

```diff
- mynavi_job_sharing: "マイナビJOB",
+ mynavi_jobshare: "マイナビJOB",
```

---

## 修正2: 本物マイナビPDFでの会社名検証

### テストデータ

テスト候補者 5999999（大野 テスト）に以下のマイナビJOB生ファイル名PDFがアップ済みだった:

| CandidateFile ID | ファイル名 | externalJobRef | platformSubmittedAt |
|---|---|---|---|
| `cmr5p5pym00021dn6f8dnfalc` | `33636_株式会社富士薬品_全国募集【ルート営業】未経験歓迎.pdf` | `own-07wl9u` | 2026-07-04T01:42 |
| `cmr5o5gp700001dqjuc5f0rly` | `33636_株式会社富士薬品.pdf` | `own-07wl9u` | 2026-07-04T01:13 |
| `cmr5nyr8600061dlu9fbfklad` | `33636_株式会社富士薬品_全国募集【ルート営業】未経験歓迎.pdf` | null | 2026-07-04T01:09 |

### 検証結果

#### (1) 媒体判定

テスト時点では `detectMediaFromFilename` にマイナビ判定が無かったため、`media=own` として job-platform に送信された（externalJobRef が `own-` プレフィックス）。本修正適用後は `mynavi_jobshare` と判定される。

```
detectMediaFromFilename("33636_株式会社富士薬品_全国募集【ルート営業】未経験歓迎.pdf")
  修正前 → "own"
  修正後 → "mynavi_jobshare"
```

#### (2) 会社名検証

job-platform 側の T-131-company-name-fix.md (commit `686ae04`) の DB 実測記録より:

> `own-07wl9u`: 株式会社富士薬品（マイナビJOB由来の生ファイル名でアップされた行だが、raw_data.pdf_text の位置17に「株式会社富士薬品」を確認・Geminiは正しく抽出できていた）

**会社名 = `株式会社富士薬品`（正しい値・本文抽出由来）**。ファイル名まる写しにはなっていない。

#### (3) 原因分析

会社名がファイル名まる写しになる問題は**本PDFでは発生しなかった**。理由:

- Gemini の構造化抽出が PDF 本文から正しく「株式会社富士薬品」を抽出できた
- job-platform 側の会社名補正ロジック（`686ae04` で追加された `correctCompanyIfFilenameArtifact`）はフォールバックとして機能するが、本件では Gemini 抽出が正常だったため発動不要だった
- 会社名が壊れるのは Gemini が本文よりファイル名タイトル行を優先するケース（主に本文が少ないPDFや、先頭にファイル名由来のメタデータが出力されるPDF）であり、通常の求人票PDFでは発生しにくい

### テストデータ削除

portal 側の CandidateFile 3件を削除済み:

| 削除ID | ファイル名 |
|---|---|
| `cmr5p5pym00021dn6f8dnfalc` | `33636_株式会社富士薬品_全国募集【ルート営業】未経験歓迎.pdf` |
| `cmr5o5gp700001dqjuc5f0rly` | `33636_株式会社富士薬品.pdf` |
| `cmr5nyr8600061dlu9fbfklad` | `33636_株式会社富士薬品_全国募集【ルート営業】未経験歓迎.pdf` |

job-platform 側のテスト求人（`own-07wl9u` 等）は T-131-company-name-fix.md の検証時に既に削除済み。

---

## 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/lib/job-platform-ingest.ts` | `detectMediaFromFilename` にマイナビ判定追加（circus→mynavi→own の3値） |
| `src/lib/constants/source-media.ts` | `SOURCE_MEDIA_TO_JOBDB` キー修正: `mynavi_job_sharing` → `mynavi_jobshare` |

---

## Git / デプロイ

- コミット: **`1dbcde7`**
- Railway: **SUCCESS**（BUILDING→DEPLOYING→SUCCESS、122秒）
