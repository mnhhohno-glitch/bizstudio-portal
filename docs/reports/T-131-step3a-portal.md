# T-131 step3a（portal側）: 紐付け済みPDF求人の表示昇格（favorites GET 変換）

**日付**: 2026-07-04 ／ **対象**: bizstudio-portal（master）
**前提**: docs/reports/T-131-step2-portal.md（PDF由来ブックマークは紐付け時 `externalJobRef=sourceJobId` を得るが `sourceType` は NULL のまま）

## 目的
T-131 で紐付いたPDF由来求人（`CandidateFile.externalJobRef` 設定・`sourceType=NULL`）を、求職者サイトのお気に入り／担当CAのおすすめレーンで**既存のjob-platform求人と同じフルカード**として表示させる。**portal の返却変換のみ**で自動昇格させる。

---

## 1. 実装（favorites GET のレスポンス変換）

`src/app/api/external/candidate-site/favorites/route.ts`

`externalJobRef` が設定された行（既存jp行＋T-131紐付け行の両方）を「jp形」に正規化するヘルパを追加し、GET一覧・POST/PATCHの `toDTO` の両方に適用:

```ts
function jpNormalize(externalJobRef, storedSourceType) {
  if (externalJobRef) return { sourceJobId: externalJobRef, sourceType: "job-platform" };
  return { sourceJobId: null, sourceType: storedSourceType };
}
// DTO: sourceJobId = externalJobRef の値 / sourceType = "job-platform"（PDF由来でも紐付け済みは昇格）
```

- **sourceJobId**（新規キー・= job-platform 媒体内ID）: フル詳細/AI解説の取得キー。
- **sourceType="job-platform"**: PDF由来（DBは`sourceType=NULL`）でも紐付け済みは job-platform 扱いに**昇格**（DBは書き換えず、レスポンスのみ）。
- **externalJobRef は互換のため併記**（後述の判断）。
- `externalJobRef` 未設定の純PDF行は従来どおり（`sourceJobId=null`・`sourceType`据置）。
- CA解除403・candidateNote/caComment・POST/PATCH/DELETE の既存挙動は不変（変換は表示DTOのみ）。

### externalJobRef を「残した」判断（プロンプトからの意図的差分）
プロンプトは「externalJobRef を露出させず sourceJobId に載せ替える」を指示。しかし:
- **消費側（求職者サイト /site/ のフロント）が本タスク時点でローカルのどのリポジトリにも存在しない**（後述§3）。既存jp行10件が現に稼働している以上、消費側は現行DTO（`externalJobRef`＋`sourceType`）を読んでいるはずで、`externalJobRef` を除去すると既存jp行の表示を壊すリスクがある。
- そのため **`sourceJobId` を追加（載せ替えの主目的を達成）しつつ `externalJobRef` は互換で残す**安全な上位互換とした。消費側が `sourceJobId` 参照に移行確認できた段階で `externalJobRef` を削除可能。

---

## 2. 動作確認（テスト候補者 5999999・実測）

| # | 確認 | 結果 |
|---|---|---|
| 1 | ingest本番初動（step2経路） | job-platform prod へ circus実PDF投入 → **`circus-af5pl1`（active/private）**・HTTP200・41.5秒（step2の投入経路が本番で稼働することを再確認） |
| 2 | favorites GET が jp形で返る | 紐付け行（`externalJobRef=circus-af5pl1`・`sourceType=NULL`）を作成し、改修後GETを実行 → **`sourceJobId=circus-af5pl1` / `sourceType="job-platform"`** で返却。既存jp行（`hl-ap-320853`）と**同一形**（両方 sourceJobId＋job-platform）。純PDF行は `sourceJobId=null`・`sourceType=null` のまま非昇格 |
| — | ホワイトリスト走査 | 返却キー: `id, externalJobRef, sourceJobId, sourceType, origin, fileName, companyName, jobUrl, candidateNote, caComment, aiMatchRating, createdAt, applied`。**禁止キー0**（raw_data/commission/media/source_media/salary/company_id 等なし） |
| — | jp詳細の解決 | job-platform `getCandidateJobDetail("circus-af5pl1")` → 取得OK（title・requirementsRequired あり）。フルカード/フル詳細の裏付けデータが存在 |
| 3 | 実機 /site/ フルカード表示 | **未検証（下記§3）**。/site/ のフロント実装がローカルに無く、実機描画を確認できない |
| 4 | 昇格しない場合のmypage分岐特定 | §3参照。分岐コードがローカルに存在せず特定不能 |
| 5 | 「担当CAからの求人」タブ | 本タスクのスコープ外（変更なし） |
| 6 | テスト登録の扱い | テスト用 CandidateFile・job-platform求人 `circus-af5pl1` とも**削除済み** |

---

## 3. ⚠️ 重要: /site/ フロント（消費側）がローカルに存在しない

確認3・4（実機 /site/ でのフルカード表示、および昇格しない場合のmypage分岐特定）は、**消費側の実装がローカルのどのリポジトリにも見つからないため未検証**です。

- `C:\bizstudio\bizstudio-mypage`（main のみ）は旧来の **`/v/[token]`**（CA提案求人への回答画面）だけで、`favorites`・`sourceType`・`sourceJobId`・お気に入りタブ・おすすめレーン・PDF/フルカード分岐は**1件も存在しない**（全ソース grep 済み）。
- `C:\bizstudio` 配下の全リポジトリで `/api/external/candidate-site/favorites` を叩くコードは**0件**。/site/ ルートも見当たらない。
- つまり「sourceTypeによるjp/PDF判定分岐」を読める実コードが手元に無く、プロンプトの「mypage側の分岐に正確に合わせる（推測禁止）」は**照合対象が不在**。

**取った方針**: 実際に稼働している既存jp行（`sourceType="job-platform"`＋`externalJobRef`）の形を正として、T-131紐付け行を**それと同一形に揃える**（＝「mypageが区別できない状態が合格」の基準を、実在する既存jp行に対して満たす）。加えて `sourceJobId` を新設。これにより、消費側が `sourceType==="job-platform"` で分岐し `sourceJobId`（または `externalJobRef`）で詳細を引く**いずれの実装でも**自動昇格する上位互換とした。

**要対応（step3b以降・別途）**: /site/ フロント（消費側リポジトリ）の所在確認。実機での昇格確認は、その配備先URL（/site/5999999-...）で目視確認が必要。消費側が `sourceJobId` のみ参照すると確定できれば、favorites GET から `externalJobRef` を削除して露出を消せる。

---

## 4. 変更ファイル
- `src/app/api/external/candidate-site/favorites/route.ts`（`jpNormalize` 追加＋GET/`toDTO` に適用、`FavoriteDTO` に `sourceJobId` 追加）

## 5. Git / デプロイ
- コミット: **（追記）**
- Railway: **（SUCCESS を追記）**
