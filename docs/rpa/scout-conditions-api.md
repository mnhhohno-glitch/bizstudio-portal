# スカウト配信条件 API（RPA / PAD 向け手順書）

対象: マイナビ転職スカウト RPA（Power Automate Desktop）担当者
ポータル側担当: 大野 将幸
版: 2026-09-14 改2（T-196。`area` を `residence`（居住地）と `workLocation`（希望勤務地）に分けました。RPA 切替前のため後方互換なしで契約を置き換えています。以後この契約は変更しません）

---

## 0. 概要

ポータルの「スカウト配信条件コンソール」（`/scout/conditions`）で号機ごとに持っている
マイナビ検索条件（7軸）と配信テンプレートを、RPA が **配信前に取りに来て**、配信後に **結果を返す** ための API です。

| 用途 | メソッド | パス |
|--|--|--|
| 条件取得 | GET | `/api/external/scout-conditions/current?machineNo=2` |
| 結果送信 | POST | `/api/external/scout-conditions/runs` |

- ベースURL（本番）: `https://bizstudio-portal-production.up.railway.app`
- 認証: リクエストヘッダ `x-api-secret: <共有済みの値>`（既存の日程調整 API・配信計画 API と同じ値）。不一致は **HTTP 401**。
- 401 以外は **HTTP 200 固定**。成否は本文の `ok` で判定してください。
- **全レスポンスで同じキー集合を返します（値が無ければ `null`）。** キーの有無で分岐しないでください。
- 日時は JST。TZ 表記が無い日時は JST として解釈します。

「送信件数が 10 件未満 ＝ 枯渇」の判定と、予約（順番待ちの条件）への切替は **ポータル側が自動で行います**。RPA 側は判定しません。

---

## 1. 条件取得 `GET /api/external/scout-conditions/current?machineNo=2`

その号機で状態が **RUNNING（実行中）** の条件を、マイナビの検索フォームにそのまま入力できる形で返します。

### レスポンス例

```json
{
  "ok": true,
  "machineNo": 2,
  "condition": {
    "conditionId": "clx...",
    "searchTarget": "ONLY",
    "registDate": { "mode": "PERIOD", "days": 7, "from": null, "to": null },
    "lastLoginDays": 1,
    "gradYear": { "from": 2015, "to": 2025 },
    "companyCount": "～2社",
    "residence": {
      "mode": "NATIONWIDE",
      "regions": ["全国"],
      "prefectures": []
    },
    "workLocation": {
      "mode": "SELECTED",
      "prefectures": ["埼玉", "千葉", "東京", "神奈川", "愛知", "京都", "大阪", "兵庫"]
    },
    "template": { "templateId": "clx...", "name": "…", "subject": "…", "body": "…" },
    "plannedCount": 99
  },
  "fixed": {
    "education": "指定なし（チェックしない）",
    "jobCategory": "指定なし",
    "excludeZeroCompany": false,
    "excludeList": "含まない",
    "appliedToUs": "含まない"
  },
  "message": null
}
```

### 値の規約

| キー | 値 |
|--|--|
| `searchTarget` | `EXCLUDE`（含まない＝未送信）/ `ONLY`（のみ＝送信済）/ `INCLUDE`（含む） |
| `registDate.mode` | `PERIOD`（`days` を使う。1/3/7/14/30/60/90/180/360）/ `DATE`（`from`,`to` は `YYYY-MM-DD`。片方 null 可）/ `NONE`（指定なし） |
| `lastLoginDays` | 1/3/7/…（日以内）。null=指定なし（基本は必ず入る） |
| `gradYear.from` / `to` | 西暦4桁 or null（指定なし） |
| `companyCount` | マイナビのプルダウン表示そのまま（`0社` / `～1社` … `～6社` / `7社以上`）。指定なしは null |
| `residence.mode` | **居住地**の指定方法。`NATIONWIDE` / `EAST` / `WEST` / `PREFECTURE` |
| `residence.regions` | 居住地で親チェックを入れる地域名の配列。NATIONWIDE→`["全国"]`、EAST→`["北海道","東北","関東","甲信越"]`、WEST→`["北陸","東海","関西","中国","四国","九州"]`。PREFECTURE のときは「全都道府県が選ばれている地域」がここに入る |
| `residence.prefectures` | PREFECTURE のとき、地域ごと選ばれていない個別の都道府県名（例 `["東京","神奈川"]`）。**`regions` → `prefectures` の順にチェック**してください |
| `workLocation.mode` | **希望勤務地**の指定方法。`ALL`（指定しない。**マイナビ上は「全国」を入れる。空欄にはしない**）/ `SELECTED`（`prefectures` の都道府県を指定） |
| `workLocation.prefectures` | SELECTED のときにチェックする都道府県名の配列（例 `["埼玉","千葉","東京","神奈川","愛知","京都","大阪","兵庫"]`＝有効エリア8都府県）。`ALL` のときは常に `[]` |
| `template.subject` / `body` | 差し込み記号（`[担当者]` `[社名]` `[最終学歴]` `[経験職種]`）は **展開せず原文のまま**。展開は RPA 側の既存処理で行ってください。`template` 自体が null のこともあります（テンプレート未設定） |
| `plannedCount` | 予定件数（参考値）。null あり |
| `fixed` | 常にこの値でフォームに入力する固定値（学歴はチェックしない・経験職種は指定なし・0社を除くはチェックなし・除外リスト/自社応募は含まない）。**居住地は固定値ではなくなりました**（`condition.residence` を使ってください） |

### 条件が無い・号機が使えないとき

| 状況 | `ok` | `condition` | `message` | RPA の動き |
|--|--|--|--|--|
| RUNNING の条件が無い | `true` | `null` | `"RUNNING の条件がありません"` | **配信せず停止** |
| 存在しない号機 | `false` | `null` | `"5号機は存在しません"` 等 | 配信せず停止 |
| 停止中の号機 | `false` | `null` | `"5号機は停止中です"` | 配信せず停止 |
| `machineNo` 不正 | `false` | `null` | 理由 | 配信せず停止 |

いずれも HTTP は 200 です。`ok:false` や `condition:null` のときは配信せず、ポータル担当へ連絡してください。

---

## 2. 結果送信 `POST /api/external/scout-conditions/runs`

配信のたびに、完了通知の内容をそのまま送ってください（メール読み取りは行いません）。

### リクエスト（`Content-Type: application/json`）

```json
{
  "machineNo": 2,
  "conditionId": "clx...",
  "executedAt": "2026-09-14T10:02:00+09:00",
  "searchResultCount": "1,299件",
  "extractedCount": 150,
  "sentCount": 14,
  "rawNotification": "検索条件:...\nリスト抽出件数:150\n送信件数:14\n...",
  "dryRun": false
}
```

| キー | 必須 | 説明 |
|--|--|--|
| `machineNo` | ○ | 号機番号（1〜6） |
| `conditionId` | ○ | 1. で受け取った `condition.conditionId` |
| `executedAt` | – | 実行日時。`2026-09-14T10:02:00+09:00` 推奨。TZ 無し（`2026-09-14 10:02:00` / `2026/09/14 10:02:00`）は JST として解釈。null/省略なら受信時刻 |
| `searchResultCount` | – | **T-206（新規・任意）** マイナビ検索結果ページの「検索結果：全 1299 件」の数字（母数）。画面の文字列のまま送ってよい（`1,299` / `1,299件` / `1299 件` はポータル側でカンマ・「件」・空白を落として数値にします）。数値に直せないときは記録を null にするだけで、結果送信は成功します。省略・null 可（未改修の RPA は従来どおり動きます） |
| `extractedCount` | – | リスト抽出件数（送信できるページから実際に取り込んだ件数。省略時 0） |
| `sentCount` | ○ | 送信件数。**10 件未満で枯渇** |
| `rawNotification` | – | 完了通知の原文（そのまま保存します）。null 可 |
| `dryRun` | – | `true` なら検証と「もし送ったらどうなるか」の計算だけ行い、**DB に一切書かず通知もしません**（接続テスト用） |

※ レスポンスのキー集合は T-206 でも変えていません（PAD 側の受け取り処理はそのままで構いません）。

### レスポンス（HTTP 200 固定）

```json
{
  "ok": true,
  "runId": "clx...",
  "isDry": true,
  "switched": true,
  "currentConditionId": "clx...(切替後)",
  "queueEmpty": false,
  "message": "条件「送信済/7日以内/卒15-25/～2社/全国」が枯渇（送信5件）→ 条件「…」に切替"
}
```

| キー | 説明 |
|--|--|
| `ok` | 受理できたか。`false` のときは `message` に理由（号機不明・条件不明・`sentCount` 不正 等） |
| `runId` | 記録した実績の ID。`dryRun:true` のときは null |
| `isDry` | 枯渇（送信件数 10 件未満）か |
| `switched` | 予約の先頭に切り替えたか |
| `currentConditionId` | いまその号機で RUNNING の条件 ID（切替後）。次回の GET で同じ ID が返ります |
| `queueEmpty` | その号機の予約（順番待ち）が空か |
| `message` | 人向けの説明 |

### ポータル側の動き（RPA は気にしなくてよい）

1. 実績を記録
2. `sentCount < 10` なら枯渇。条件を「枯渇」にし、その号機の予約の先頭を「実行中」へ切替 → LINE WORKS に1行通知
3. 予約が空なら、枯渇した条件を「実行中」のまま残して配信は継続 → LINE WORKS 通知＋ポータルタスク作成（担当者へ）
4. `sentCount >= 10` は記録のみ

### 冪等性（再試行してよい）

同じ `machineNo`＋`conditionId`＋`executedAt`（**分単位**）の再送は新規記録せず、既存の実績と同じ内容を返します。
通信エラー時はそのまま同じ body を再送してください（二重記録・二重切替は起きません）。

### `conditionId` が既に RUNNING でないとき

（既に切替済みの条件の結果が遅れて届いた等）実績は記録します（事実なので捨てません）が、枯渇判定・切替はしません。`message` にその旨を返します。

---

## 3. 接続テストの手順

1. `GET .../current?machineNo=1` を叩き、`ok:true` で `condition` と `fixed` の全キーが揃うことを確認
2. `GET .../current?machineNo=5`（停止中）で `ok:false`・`condition:null`・HTTP 200 を確認
3. `POST .../runs` を `"dryRun": true` で送り、`ok:true`・`runId:null` が返ることを確認（DB は変わりません）
4. 本番運用に切り替えるときは `dryRun` を `false`（または省略）にする

### curl 例

```bash
curl -s -H "x-api-secret: $SECRET" \
  "https://bizstudio-portal-production.up.railway.app/api/external/scout-conditions/current?machineNo=2"

curl -s -X POST -H "x-api-secret: $SECRET" -H "Content-Type: application/json" \
  --data-binary @body.json \
  "https://bizstudio-portal-production.up.railway.app/api/external/scout-conditions/runs"
```

（日本語を含む body は UTF-8 のファイルにして `--data-binary` で送ってください）

---

## 4. 旧方式（マイナビ「保存した検索条件」経由）との関係

旧方式の RPA 検索条件管理（`/admin/rpa-scout`・件名テンプレート）は切替完了まで併存します。
本 API の条件を使う号機では、マイナビ側の保存済み検索条件は使わず、本 API の `condition` をフォームへ直接入力してください。
