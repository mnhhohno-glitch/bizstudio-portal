# T-064 Candidate テーブル内訳調査

調査日時: 2026-05-25 00:10 UTC
調査対象: 本番 DB (Railway)

---

## 1. Candidate 全件数

| 項目 | 件数 |
|--|--|
| **全 Candidate** | **3,875件** |

---

## 2. applicationRoute 別の件数

| applicationRoute | 件数 |
|--|--|
| スカウト | 42 |
| (null) | 3,833 |
| **合計** | **3,875** |

※ applicationRoute が null のレコードはスカウト以外の応募経路（エージェント等）で取り込まれた求職者。

---

## 3. applicationRoute = "スカウト" の Candidate 数

**42件**

---

## 4. applicationRoute = "スカウト" かつ createdAt >= "2026-01-11" の件数

**42件**（= スカウト全件が 2026-01-11 以降に作成されている）

---

## 5. applicationRoute = "スカウト" かつ scoutDeliverySlotId IS NOT NULL の件数

**13件**（= backfill 本番実行で紐付けされた 13件）

紐付け率: 13 / 42 = **31.0%**
（recruiterName が空の 28件を除くと: 13 / 14 = **92.9%**）

---

## 6. createdAt の最古と最新

| 項目 | 値 (UTC) | JST 換算 |
|--|--|--|
| 最古 | 2026-02-17T12:40:27.657Z | 2026-02-17 21:40 JST |
| 最新 | 2026-05-25T00:05:20.420Z | 2026-05-25 09:05 JST |

---

## 所見

- スカウト経由の Candidate は全て 2026-01-11 以降に作成されており、backfill 対象期間のフィルタは実質的に全件を網羅
- recruiterName が埋まっている 14件中 13件（92.9%）が自動紐付け済み
- 残り 1件は ScoutMachineMaster にマスタが存在しない担当者名
- recruiterName が空の 28件は T-064 PDF取り込み機能の導入前に登録された旧データで、手動紐付けが必要
