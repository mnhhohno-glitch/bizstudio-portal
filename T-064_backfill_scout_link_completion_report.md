# T-064 既存応募者の一括自動紐付けバッチ 完了報告書（DRY RUN まで）

実装日: 2026-05-25
commit: `87a52e4` (master push)
状態: **DRY RUN 完了 / 本番実行は将幸さん OK 後に別ターンで実施**

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | `scripts/backfill-scout-link.ts` 新規作成 | ✅ |
| 2 | `scripts/test-backfill-scout-link.ts` 新規作成 | ✅ |
| 3 | ローカルテスト PASS | ✅ 12 PASS / 0 FAIL |
| 4 | 本番 DRY RUN 実行・結果取得 | ✅ 40件分析 |
| 5 | DRY RUN 結果を `scripts/backfill-result-dry-run.log` に保存 | ✅ |
| 6 | master マージ済 | ✅ commit 87a52e4 |
| 7 | 完了報告書（DRY RUN まで）作成 | ✅ 本ファイル |
| 8 | 本番実行 | ⏸️ **将幸さん OK 待ち** |

---

## 1. バッチスクリプト仕様

### `scripts/backfill-scout-link.ts`

- **対象**: `applicationRoute = "スカウト"` かつ `scoutDeliverySlotId IS NULL` かつ `createdAt >= 2026-01-11`
- **ロジック**: 既存の `src/lib/scout/auto-link.ts` の `autoLinkCandidateToSlot()` を全件適用（流用）
- **モード**:
  - `--dry-run`: `findMatchingSlot` のみ呼んで集計、DB 書き込みなし
  - 引数なし: `autoLinkCandidateToSlot` を呼んで DB 書き込み
- **進捗ログ**: 100件ごとに `進捗: N/M件処理済み`
- **冪等性**: 既に `scoutDeliverySlotId` が入っている Candidate は対象から外れるため、再実行可能
- **scoutLinkedById**: 常に `null`（ユーザー操作ではなくバッチのため、既存の autoLink 仕様と同じ）

### 結果カテゴリ（`AutoLinkReason`）

| reason | 意味 |
|--|--|
| `matched` | 紐付け成功 |
| `no_recruiter_name` | recruiterName が空 / null |
| `no_machine_master` | recruiterName が ScoutMachineMaster にヒットせず |
| `no_candidate_today` | 当日にスロット無し（今は前日も探すため実質出現しない） |
| `no_candidate_yesterday` | 前日にもスロット無し |
| `error` | 内部例外 |

### DRY RUN 仕様の注意

DRY RUN は `findMatchingSlot` のみを呼ぶため、`null` 戻り値が「machine 無し」か「slot 無し」か区別できない。  
→ DRY RUN の集計ではいずれも `no_candidate_yesterday` に括る（旧 PR の挙動と一致）。  
本実行（`autoLinkCandidateToSlot`）では正しく分類される。

---

## 2. ローカルテスト結果

`scripts/test-backfill-scout-link.ts`: **12 PASS / 0 FAIL**

検証内容:
- 対象 Candidate 5件（matched用2 + no_machine用1 + no_recruiter用2）の作成 → backfill ロジック適用
- カウント集計が想定通り (matched=2, no_machine_master=1, no_recruiter_name=2)
- DB 反映確認 (scoutDeliverySlotId, scoutNumber, scoutLinkedAt が正しくセット、scoutLinkedById=null)
- 冪等性確認（再実行時に紐付け済 Candidate は対象から外れる）
- DRY RUN 相当呼び出し（findMatchingSlot のみ）で DB が変更されないこと

---

## 3. 本番 DRY RUN 結果（2026-05-25 23:38 UTC）

```
=== T-064 過去応募者 自動紐付けバッチ ===
モード: DRY RUN（DB書き込みなし）
対象期間: 2026-01-11T00:00:00.000Z 以降
開始時刻: 2026-05-24T23:38:35.172Z

対象 Candidate: 40件

=== 結果 ===
モード: DRY RUN
対象: 40件
紐付け成功 (matched): 1件
担当者マスタ未マッチ (no_machine_master): 0件   ※DRY RUNでは no_candidate_yesterday に集約される
同日スロット無し (no_candidate_today): 0件
前日も無し (no_candidate_yesterday): 11件        ※machine 無し + slot 無しを含む
recruiterName 空 (no_recruiter_name): 28件
エラー (error): 0件
所要時間: 5.5秒
```

ファイル: `scripts/backfill-result-dry-run.log`

---

## 4. 紐付かなかった応募者の傾向分析

DRY RUN の結果を更に分析した内訳（一時スクリプトで集計、後で削除済）:

### A) recruiterName 空: **28件**（全件マイナビ転職）

T-064 実装以前に取り込まれた Candidate は `recruiterName` カラムが埋まっていないため、紐付け不可。
このカテゴリは現状の自動紐付けロジックでは救えない。

### B) recruiterName あり: **12件**

| recruiterName（実際の Candidate に保存されている値） | 件数 | ScoutMachineMaster との照合 |
|--|--|--|
| `藤本なつみ` | 3 | **なし**（マスタは「藤本 なつみ」） |
| `RPA 1号機` | 2 | **なし**（マスタは別表記） |
| `岡田愛子` | 2 | **なし**（マスタに該当者なし） |
| `大野 望` | 1 | **あり** ✅ → 唯一紐付かなかったのは「同日にスロット無し」 |
| `RPA 2号機` | 1 | **なし** |
| `大野 将幸` | 1 | **なし**（マスタに該当者なし） |
| `RPA 3号機` | 1 | **なし** |
| `大野望` | 1 | **なし**（マスタは「大野 望」） |

### 根本原因

**スペース揺れ**が主因。マスタは「藤本 なつみ」「大野 望」のように半角スペース区切りで登録されているが、過去の Candidate には:
- スペースなし版（`藤本なつみ`, `大野望`）
- 別表記版（`RPA 1号機` vs マスタ表記）

が混在している。

`auto-link.ts` の `findMachineByRecruiterName` は `trimmed.replace(/\s+/g, " ")` `trimmed.replace(/\s+/g, "　")` でスペース揺れを吸収しているが、**「スペース無し → スペース挿入」のケースは吸収できない**（漢字姓と名前の境界を判定できないため）。

---

## 5. 推奨アクション（バッチ実行前の判断ポイント）

DRY RUN 結果から、本実行しても **新規に紐付くのは 1件のみ**。
→ 本実行のメリットは限定的。**先に以下のいずれかを検討するのが効率的**。

### 選択肢A: ScoutMachineMaster のエイリアス追加

「藤本なつみ」「大野望」「RPA 1号機」等を別レコードとしてマスタに追加 or 既存マスタにエイリアス列を追加。
これにより本実行で 12件中 ~10件が紐付く見込み（A のスペースなし＋ RPA 表記の合計）。

### 選択肢B: 過去 Candidate の recruiterName 正規化

過去の 12件の recruiterName を手動で UPDATE してマスタ表記に揃える。
↓ ただし「岡田愛子」「大野 将幸」は ScoutMachineMaster に該当者がいないため、これは別途検討要。

### 選択肢C: そのまま本実行（最小工数）

1件のみ自動紐付け、残りの 39件は ScoutLinkPanel から手動紐付け運用に任せる。
→ 5/30 までの工数を考えると現実的だが、過去データの精度は限定的。

### 選択肢D: 何もしない

過去の 40件は紐付かないまま運用開始。応募日別集計画面では空欄。
↓ 引き継ぎ時に「データ移行前の応募者」と明示すれば混乱は最小化可能。

---

## 6. 本番実行手順（将幸さん OK 後）

```powershell
# 念のため対象期間の現状件数を再確認
npx tsx scripts/backfill-scout-link.ts --dry-run

# 本実行（DB 書き込み）
npx tsx scripts/backfill-scout-link.ts | tee scripts/backfill-result.log
```

- 本実行後、`scripts/backfill-result.log` を `T-064_backfill_scout_link_completion_report.md` に追記
- 紐付かなかった Candidate は ScoutLinkPanel で手動紐付け or 上記「選択肢A/B」を検討

---

## 7. 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `scripts/backfill-scout-link.ts` | 新規 | バッチ本体 |
| `scripts/test-backfill-scout-link.ts` | 新規 | 統合テスト 12 PASS |
| `scripts/backfill-result-dry-run.log` | 新規 | DRY RUN 結果ログ |
| `src/lib/scout/auto-link.ts` | 変更なし | 流用のみ |

---

## 8. 変更禁止ファイル

以下は触っていない:
- `src/lib/scout/auto-link.ts`（流用のみ、変更なし）
- `src/constants/candidate-flags.ts`
- `specs/` 配下
- `scripts/gas/` 配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`

---

## 9. 次のターンで実施すること

将幸さんから本実行の OK が出たら:
1. 本実行（引数なし） + ログ保存
2. 本報告書に「6. 本番実行結果」セクションを追記
3. 紐付かなかった Candidate の傾向に応じて、ScoutMachineMaster の整備など追加タスクを起票

または、選択肢A/B を採用する場合は、別タスクとして起票してから backfill 本実行。
