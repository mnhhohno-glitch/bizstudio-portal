# KIM KEONHOE 外国籍判定失敗 調査報告

調査日: 2026-05-24
調査者: Claude Code (Opus 4.6)

---

## 1. MynaviRpaProcessingLog レコード

| カラム | 値 |
|--|--|
| id | `cmpj4pjnr00071dnzefvivvqa` |
| batchId | `cmpj4ktcj00041dnz0cdq8e2e` |
| candidateName | `KIM KEONHOE` |
| candidateAge | 32 |
| canSendReply | **false** |
| status | **FOREIGN_NG** |
| reason | `外国籍` |
| replySentAt | `2026-05-24T10:58:54.000Z`（JST 19:58:54） |
| replyResult | **SUCCESS** |
| errorMessage | null |
| processedAt | `2026-05-24T01:58:56.199Z`（JST 10:58:56） |
| pdfFileName | `5007948_KIM KEONHOE.pdf` |

---

## 2. 紐付く Candidate レコード

| カラム | 値 |
|--|--|
| id | `cmpj4pexf00051dnz8ezzh9du` |
| name | `KIM KEONHOE` |
| nameKana | `キム ゴニ` |
| birthday | `1994-03-21` |
| recruiterName | `藤本なつみ` |
| createdAt | `2026-05-24T01:58:50.000Z`（JST 10:58:50） |
| mynaviScoutSentAt | null |

---

## 3. 判定結果

### 結論

**✅ 仮説A確定: portal は canSendReply=false を正しく返した。PAD側で分岐していない（無条件送信）。**

### 根拠

- portal は `status=FOREIGN_NG`、`reason=外国籍`、`canSendReply=false` を正しく記録した
- にもかかわらず `replyResult=SUCCESS`、`replySentAt=2026-05-24T10:58:54.000Z` が記録されている
- これは PAD が reply-sent API を呼び出して「送信成功」を報告したことを意味する
- つまり PAD は `canSendReply` の値を確認せず一次返信メールを送信した

---

## 4. 全期間の canSendReply=false & replyResult=SUCCESS（PAD 無条件送信の証拠）

| 氏名 | 年齢 | status | reason | processedAt |
|--|--|--|--|--|
| null | null | AI_FAILED | AI解析失敗（Gemini解析エラー） | 2026-05-24 19:43 JST |
| **KIM KEONHOE** | **32** | **FOREIGN_NG** | **外国籍** | **2026-05-24 10:58 JST** |
| 加藤 聖也 | 26 | DUPLICATE_SKIP | 直近30分以内に同一電話番号の処理あり | 2026-05-23 19:37 JST |
| 大岡 梨沙 | 22 | DUPLICATE_SKIP | 直近30分以内に同一電話番号の処理あり | 2026-05-23 13:33 JST |
| 大岡 梨沙 | 22 | DUPLICATE_SKIP | 直近30分以内に同一電話番号の処理あり | 2026-05-23 13:25 JST |
| 木田 朱夏 | 27 | DUPLICATE_SKIP | 直近30分以内に同一電話番号の処理あり | 2026-05-17 07:25 JST |

**合計 6件** が `canSendReply=false` なのに送信されている。

### 正常にスキップされたケース（canSendReply=false & replyResult=null）

| 氏名 | status | reason | processedAt |
|--|--|--|--|
| 米澤 弥黎 | DUPLICATE_SKIP | 重複 | 2026-05-17 07:12 JST |
| null | AI_FAILED | Gemini解析エラー | 2026-05-17 05:38 JST |
| null | AI_FAILED | intake接続エラー | 2026-05-17 05:35 JST |
| null | AI_FAILED | intake接続エラー | 2026-05-17 05:06 JST |

**合計 4件** のみ。いずれも 5/17 早朝で、おそらくこの時点では PAD に分岐があったか、PAD が別の理由で送信に至らなかった。

### 時系列パターン

- **5/17 05:06〜07:12**: canSendReply=false → 正常スキップ（4件）
- **5/17 07:25 以降**: canSendReply=false → 無条件送信（6件）

→ **5/17 07:25 前後で PAD の挙動が変わった**（分岐削除 or フロー変更が入った可能性）。

---

## 5. 影響範囲

canSendReply=false で送信されたのは以下のステータス:

| status | 件数 | 影響度 |
|--|--|--|
| FOREIGN_NG | 1 | **高**（外国籍の方に日本語テンプレートで返信） |
| DUPLICATE_SKIP | 3 | **中**（二重返信、同じ人に複数回送信） |
| AI_FAILED | 2 | **高**（年齢チェックも外国籍チェックも未実施で送信） |

---

## 6. 次アクション推奨

### 即時対応（PAD 修正）

1. **PAD フローに `canSendReply` 分岐を追加（または復旧）**
   - `/api/rpa/mynavi/pdf-upload` のレスポンスから `canSendReply` を取得
   - `canSendReply === false` の場合はメール送信ステップをスキップ
   - reply-sent API は `canSendReply=true` の場合のみ呼び出す

2. **原因特定**
   - 5/17 07:25 前後で PAD フローを変更した記録がないか確認
   - PAD のバージョン管理・変更履歴を確認

### 追加防衛策（portal 側）

3. **reply-sent API にガード追加を検討**
   - `/api/rpa/mynavi/reply-sent` が呼ばれた際、該当ログの `canSendReply` を確認
   - `canSendReply=false` なのに reply-sent が来た場合は warning ログ出力 or LINE 通知
   - ただしこれは PAD 修正が先（portal でブロックすると PAD のフロー管理と不整合になる可能性）

---

## 7. 補足: portal 側判定ロジックは正常動作

外国籍判定は正しく動作している証拠:
- `candidateName: "KIM KEONHOE"` → 全て英字 → `isForeignNg=true` と判定
- `status: "FOREIGN_NG"`, `reason: "外国籍"`, `canSendReply: false` を正しく返却
- portal 側に修正は不要
