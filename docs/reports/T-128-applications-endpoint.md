# T-128 完了報告：candidate-site 応募一覧（応募日付き）エンドポイント追加

実施日: 2026-07-02 ／ 対象: bizstudio-portal（本番=master）
種別: 読み取り専用の新規エンドポイント1本追加（既存不変・DBスキーマ変更なし）

---

## 1. エンドポイント仕様

```
GET /api/external/candidate-site/applications?candidateNumber=5999999
（または ?candidateId=<cuid>）
```

- **認可**: `X-Auth-Key: <CANDIDATE_SITE_API_KEY>`（T2 と同一・fail-closed）。未設定/欠落/不一致は全 **401**（timingSafeEqual）。
- **候補者解決**: T2 の `resolveScopedCandidate`（candidateId 優先・無ければ candidateNumber）。存在しなければ **404**。
- **スコープ**: 解決済み候補者IDを全クエリ条件に固定。他候補者のデータは返らない。
- **データ源**: T2 で作成済みの `CandidateJobApplication`（`appliedAt` を保持）。データは既にあり、返す口を追加しただけ。
- **求人メタ肉付け**: `CandidateFile`（category=BOOKMARK・非アーカイブ・同候補者）を `externalJobRef` で突き合わせ、会社名・ファイル名・URL をベストエフォートで同梱。無ければ ref のみ（mypage が job-platform 詳細で肉付け）。
- **ホワイトリスト**: `externalJobRef`・`appliedAt`・求人メタ(companyName/fileName/jobUrl) のみ。`notifiedAt` 等の内部運用情報・通知先CA情報は**返さない**。
- **応募0件**: 200 で空配列。

### レスポンス形

```json
{
  "ok": true,
  "candidateNumber": "5999999",
  "applications": [
    {
      "externalJobRef": "hl-ap-164691",
      "appliedAt": "2026-07-02T12:14:39.810Z",
      "companyName": "パーソルクロステクノロジー株式会社",
      "fileName": "求人票_パーソルクロステクノロジー株式会社.pdf",
      "jobUrl": "/jobs?id=hl-ap-164691"
    }
  ]
}
```

**応募0件**:
```json
{ "ok": true, "candidateNumber": "5004311", "applications": [] }
```

### フィールド定義
| フィールド | 型 | 内容 |
|---|---|---|
| `applications[].externalJobRef` | string | job-platform 求人ID（source_job_id） |
| `applications[].appliedAt` | string | 応募日時（ISO8601 UTC）。新しい順 |
| `applications[].companyName` | string\|null | BOOKMARK の fileName から抽出した会社名。無ければ null |
| `applications[].fileName` | string\|null | 突き合わせた BOOKMARK ファイル名。無ければ null |
| `applications[].jobUrl` | string\|null | BOOKMARK の memo（求人URL）。無ければ null |

- 並び順: `appliedAt` 降順（新しい応募が先頭）。

---

## 2. 検証結果（ローカル dev + 共有本番DB・読み取りのみ）

一時キーを inline 設定した dev サーバー（.env 非変更）で本番DBに対し実施。全て GET。

| # | 検証項目 | 結果 |
|---|---|---|
| 1 | 認可: no-key / wrong-key / 正キー | **401 / 401 / 200** ✓ |
| 2 | 応募あり(5999999・T2/T4検証の1件) | `appliedAt`(2026-07-02T12:14:39.810Z)付き一覧・会社名肉付けあり ✓ |
| 3 | 応募0件(5004311) | **空配列** ✓ |
| 4 | 存在しない候補者番号(0000000) | **404** ✓ |
| 5 | 全キー走査 | トップ=[ok,candidateNumber,applications]・item=[externalJobRef,appliedAt,companyName,fileName,jobUrl] のみ。**notifiedAt・CA情報・レコードid・candidateId の混入なし** ✓（※走査で "id" は jobUrl の `?id=` にマッチしただけの誤検知） |
| 6 | すり替え拒否 | 5999999/5004311 いずれも要求番号=応答番号で一致 ✓ |
| 7 | 本番ビルド（next build） | **成功**・ルート `/api/external/candidate-site/applications` 登録確認 ✓ |

- ホワイトリスト実装: `CandidateJobApplication` の select は `externalJobRef`・`appliedAt` のみ。`notifiedAt`/`createdAt`/`updatedAt`/`candidateId`/`id` は select していない（コードレベルで到達不能）。担当CA情報（employee/lineUserId 等）にはそもそもアクセスしない。

---

## 3. コミット・push・デプロイ

- コミット: `feat(candidate-site): expose application history with appliedAt`
- add 対象（パス明示・`git add -A` 不使用）:
  - `src/app/api/external/candidate-site/applications/route.ts`（新規）
  - `docs/reports/T-128-applications-endpoint.md`（本報告）
- （コミットID・push・Railwayデプロイ結果は本文末尾に追記）

---

## 4. mypage（T4第2弾）向けレスポンス例・接続情報

- ベースURL: `https://bizstudio-portal-production.up.railway.app`
- ヘッダ: `X-Auth-Key: <CANDIDATE_SITE_API_KEY>`（T2 と同一キー・本番設定済み）
- 呼び出し: `GET /api/external/candidate-site/applications?candidateNumber=<番号>`
- 用途: マイページタブの応募リストに **応募日時（appliedAt）** を表示。favorites 応答（応募refのみ）では持てなかった日付をこちらで供給。
- 肉付け方針（mypage側）: `companyName`/`fileName` が null の項目は `externalJobRef` で job-platform 詳細を引いてカード表示を補完。`appliedAt` は UTC のため表示時に JST 変換。

**レスポンス例（応募1件）**:
```json
{
  "ok": true,
  "candidateNumber": "5999999",
  "applications": [
    {
      "externalJobRef": "hl-ap-164691",
      "appliedAt": "2026-07-02T12:14:39.810Z",
      "companyName": "パーソルクロステクノロジー株式会社",
      "fileName": "求人票_パーソルクロステクノロジー株式会社.pdf",
      "jobUrl": "/jobs?id=hl-ap-164691"
    }
  ]
}
```

---

## 5. 制約・設計メモ
- `notifiedAt`・担当CA情報等の内部運用情報は返さない（ホワイトリスト厳守）。
- DBスキーマ変更なし・既存エンドポイント不変・読み取り専用。
- 認可キー未設定環境（staging 等）は fail-closed で全 401（意図どおり）。
