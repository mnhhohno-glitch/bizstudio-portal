# supportStatus 自動ENDED バグ 原因調査レポート

調査日: 2026-04-20
対象: 求職者ID 5004276 鳥海慶次郎 — 1社選考落ちで supportStatus が ENDED に変更された

## 原因特定

### 根本原因: `src/lib/support-status-auto.ts` の `checkAutoSupportEnd` 関数

この関数がエントリーフラグ変更時に自動で `supportStatus = "ENDED"` を設定している。

**導入コミット**: `ee34f3e` (2026-04-03) `feat: 支援終了理由の選択機能 + エントリーフラグ自動連動`

### 発火フロー（再現手順）

```
1. エントリーボードで鳥海さんのエントリーの entryFlagDetail を「選考落ち」に変更
   （UI: EntryBoard.tsx L214-232 → handleFlagUpdate）

2. PATCH /api/entries/{entryId}/flags が呼ばれる
   （src/app/api/entries/[entryId]/flags/route.ts）

3. flags/route.ts L40-50: isActive を判定
   - personFlag が "見送り通知送信済" の場合 → isActive = false
   - または entryFlagDetail だけ変更の場合でも、既存の personFlag が
     INACTIVE_TRIGGERS に含まれていれば isActive = false

4. flags/route.ts L59-62: JobEntry を update（isActive = false を含む）

5. flags/route.ts L77-82: checkAutoSupportEnd() を呼び出し
   引数:
   - candidateId: 鳥海さんのID
   - triggerEntryFlag: "書類選考" 等
   - triggerFlagDetail: "選考落ち"
   - triggerPersonFlag: "見送り通知送信済" 等

6. support-status-auto.ts L15-19: candidate の supportStatus 確認
   → ENDED でなければ続行

7. support-status-auto.ts L40-41: countActiveEntries() を実行
   → 鳥海さんのエントリーが1社のみ、かつ isActive = false に更新済み
   → activeCount = 0

8. support-status-auto.ts L54: triggerFlagDetail === "選考落ち"
   → reason = "REJECTED_ALL"

9. support-status-auto.ts L67-76: candidate を UPDATE
   → supportStatus = "ENDED"
   → supportEndReason = "REJECTED_ALL"
   → supportEndDate = new Date()
```

### 呼び出し元（1箇所のみ）

| ファイル | 行 | 呼び出しコンテキスト |
|---|---|---|
| `src/app/api/entries/[entryId]/flags/route.ts` | L77 | エントリーフラグ更新後のフック |

※ `bulk-flags/route.ts` は `checkAutoSupportEnd` を呼んでいない（bulk操作では自動終了なし）

### supportStatus を変更する全箇所

| # | ファイル | 行 | トリガー | 自動/手動 |
|---|---|---|---|---|
| 1 | `src/lib/support-status-auto.ts` | L28-36 | 入社決定（personFlag = "入社済"/"入社案内通知済"） | **自動** |
| 2 | `src/lib/support-status-auto.ts` | L67-76 | 全エントリー inactive + 選考落ち等 | **自動** ← **バグ** |
| 3 | `src/components/candidates/SupportEndModal.tsx` | L48-54 | 支援終了モーダルで理由選択して保存 | 手動 |
| 4 | `src/app/(app)/candidates/[candidateId]/page.tsx` | L1530 | ヘッダーの supportStatus ドロップダウン変更 | 手動 |
| 5 | `src/app/(app)/admin/master/CandidateListClient.tsx` | L196 | 求職者一覧のステータスドロップダウン変更 | 手動 |
| 6 | `src/app/(app)/admin/master/CandidateRegistrationModal.tsx` | L209 | 求職者新規登録時 | 手動 |
| 7 | `src/app/api/candidates/[candidateId]/update/route.ts` | L65-80 | 汎用更新API（上記UIから呼ばれる） | API |

### バグの核心

`checkAutoSupportEnd` は「全エントリーが inactive になったら自動で支援終了する」というロジック。
これは **仕様違反**:

> 支援終了は **必ず人間の判断で手動設定** する仕様

このロジックが書かれた背景の推測:
- コミット `ee34f3e` で「支援終了理由の選択機能 + エントリーフラグ自動連動」として一括実装
- `SUPPORT_END_REASONS` の `auto: true` フラグから、自動終了を意図して設計された
- ただし「全選考落ちで自動終了」は1社しかエントリーがない場合にも発火するため、事実上「1社落ちただけで終了」になる

### 影響範囲

`checkAutoSupportEnd` が発火する条件:

| 条件 | reason | 自動終了される |
|---|---|---|
| personFlag = "入社済" or "入社案内通知済" | HIRED | ✅（全エントリー関係なく） |
| activeCount = 0 + flagDetail = "本人辞退_他社決" | OFFER_DECLINED_OTHER | ✅ |
| activeCount = 0 + flagDetail = "本人辞退_自社他" | OFFER_DECLINED_SELF | ✅ |
| activeCount = 0 + flagDetail = "本人辞退" | WITHDREW_DURING_SELECTION | ✅ |
| activeCount = 0 + personFlag = "辞退受付済" | WITHDREW_DURING_SELECTION | ✅ |
| activeCount = 0 + flagDetail = "選考落ち" | REJECTED_ALL | ✅ ← **鳥海さんのケース** |
| activeCount = 0 + flagDetail = "クローズ" | WITHDREW_DURING_SELECTION | ✅ |
| activeCount = 0 + personFlag in INACTIVE_TRIGGERS | WITHDREW_DURING_SELECTION | ✅ |

---

## 修正方針の提案

### 案A: checkAutoSupportEnd 関数を完全削除（推奨）

**内容**: `src/lib/support-status-auto.ts` を削除し、`flags/route.ts` からの呼び出しも削除。

**メリット**:
- 仕様に完全準拠（supportStatus 変更は手動のみ）
- シンプルで確実
- 入社決定（HIRED）も手動管理に統一

**デメリット**:
- 入社決定時も手動で支���終了する必要がある（ただし SupportEndModal に "入社決定" 理由は既にある）

**影響範囲**: `support-status-auto.ts` と `flags/route.ts` の2ファイルのみ

### 案B: 入社決定のみ自動、それ以外は削除

**内容**: `checkAutoSupportEnd` から「入社決定（HIRED）」の自動終了だけ残し、選考落ち等の自動終了を削除。

**メリット**:
- 入社決定は明確に「支援完了」なので自動化は合理的
- 選考落ち・辞退の誤終了は防げる

**デメリット**:
- 「入社決定だけ特別扱い」のロジックが残��
- 将来の保守で「なぜこれだけ自動なのか」の疑問が生じる

**影響範囲**: `support-status-auto.ts` の L39-76 を削除

### 案C: activeCount チェックを厳格化

**内容**: 「全エントリー inactive」の条件に加え、「候補者に2社以上のエントリーがあり、かつ全て inactive」の場合のみ自動終了。

**メリット**:
- 1社だけの場合のバグは防げる

**デメリット**:
- 2社以上でも全落ちしたら同じ問題が再発する
- 根本的な仕様違反を解決していない
- **非推奨**

---

## 推奨

**案A（完全削除）** を推奨。理由:

1. 将幸さんの仕様「��援終了は必ず手動」に完全一致
2. ��ード量が最も少なく、バグの再発リスクがゼロ
3. 入社決定時も SupportEndModal で「入社決定」を選択すれば1クリックで対応可能
4. `support-end-reasons.ts` の `auto: true` フラグは UI表示用に残してもよい（将来の参照用）

---

## 修正の具体的な差分（案A の場合）

### 変更1: `src/lib/support-status-auto.ts` を削除

ファイルごと削除。

### 変更2: `src/app/api/entries/[entryId]/flags/route.ts`

L5 の import を削除:
```diff
- import { checkAutoSupportEnd } from "@/lib/support-status-auto";
```

L75-85 の呼び出しを削除:
```diff
-  // Auto-linkage: check if candidate should be auto-ended
-  try {
-    await checkAutoSupportEnd(
-      entry.candidate.id,
-      entryFlag || entry.entryFlag || null,
-      entryFlagDetail || entry.entryFlagDetail || null,
-      personFlag !== undefined ? personFlag : entry.personFlag || null
-    );
-  } catch (e) {
-    console.error("[Flags] Auto support end check failed:", e);
-  }
```

### 変更3: 不要になるファイル参照の確認

- `src/lib/constants/entry-flag-rules.ts`: `SELECTION_ENDED_DETAILS` と `INACTIVE_TRIGGERS` は
  `flags/route.ts` と `bulk-import/route.ts` でも使用されているため削除不可
- `src/lib/constants/support-end-reasons.ts`: `auto: true` フラグは UI 側では使っていないが、
  ドキュメント的な意味があるため残す

---

## フェーズ3: 鳥海さんデータ修正

修正方針の確認後に `scripts/fix-toriumi-support-status.ts` を作成予定。

- 候補者番号: 5004276
- 現在の supportStatus: ENDED → ACTIVE に戻す
- supportEndReason: null に戻す
- supportEndDate: null に戻す
- DRY RUN → --execute の2段階

## フェーズ4: 全件監査

`scripts/audit-support-status.ts` を作成予定。

- `supportStatus = "ENDED"` かつ `supportEndReason` が auto 系（HIRED, REJECTED_ALL, WITHDREW_DURING_SELECTION 等）の候補者を抽出
- 将幸さんの個別判断用リストとして出力
