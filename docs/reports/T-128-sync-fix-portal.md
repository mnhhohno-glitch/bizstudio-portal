# T-128 同期バグ修正: 気になるOFF受信＋対象外ブックマーク同期＋残骸掃除（portal側）

実施日: 2026-07-03 ／ 対象: bizstudio-portal（master）／ 前提: `docs/reports/T-128-count-mismatch-survey.md`

---

## 0. サマリ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | 気になるOFF（response=null）の受信→CandidateJobResponse削除 | 実装 |
| 2 | 対象外(EXCLUDED)連動のブックマークarchive（到達経路=portal起点DELETE）／復帰un-archive | 実装＋**非到達経路を報告** |
| 3-a | 気になる残骸(stale CandidateJobResponse)の掃除バックフィル | dry-run→CSV→ID限定実行 |
| 3-b | 対象外済み求人の残留ブックマークarchiveバックフィル | dry-run→CSV→ID限定実行 |

**調査で判明した重要な訂正（前レポートの誤りを含む）**:
- 前レポート（count-mismatch-survey）は「5008089 のお気に入り15件のうち9件がEXCLUDED求人＝favoritesは6件になるべき」としたが、**これは誤り**。実データ突合で、9つのEXCLUDED求人は `会社名_NoXXX`（重複導入）で、各社にクリーン名のアクティブ重複求人が存在し、ブックマークの正規化名は**アクティブ側**を指す。**5008089 の favorites=15 は「15アクティブ求人＝15ブックマーク」で整合しており、archive対象は0件が正しい**（§3-b・検証2参照）。
- 3-a の「正」データ源は projects の `by-job-seeker-id/{num}/jobs` の feedback_status では**ない**。同エンドポイントは CA選考パイプライン状態（UNANSWERED/IN_SELECTION/PENDING/SELECTION_ENDED/EXCLUDED）を返し、候補者の「気になる/応募したい」は反映されない。候補者feedback は mypage admin エンドポイントの `feedbacks` 辞書（JobFeedback）＋可視性(EXCLUDED)判定を併用する（§3-a参照）。

---

## 1. Phase 1: 気になるOFF通知の受信修正

### 送信payloadの実測（kyuujin/mypage側・読み取り確認）

/v/（bizstudio-mypage）で「気になる」等をOFFにすると、`useMypage.ts` が `newStatus="none"` → `response=null` を算出し、`api.ts` が `axios.post("/api/candidate-response", { candidateId, jobId, response: null, respondedAt })` を送る（キーあり・**リテラル null**）。mypage の中継ルートがそのまま portal へ転送する。

到達する実payload:
```json
{ "candidateId": "<candidateNumber>", "jobId": <number>, "response": null, "respondedAt": "<ISO8601>" }
```
（kyuujin backend `portal_service.py` は submit 時のみ・かつ `status!="none"` のみ送信するため、OFF を送るのは mypage フロントのこの経路のみ。）

### 修正（`src/app/api/external/candidate-response/route.ts`）

- 構造的必須（candidateId・jobId）欠落は従来どおり 400。
- `response` が `null / "" / "none" / "NONE"` を**取り消し**として受理し、該当（候補者×求人）の CandidateJobResponse を**削除**（冪等・複合キー `candidateId_externalJobId` で特定）。
- 未知の値（WANT_TO_APPLY/INTERESTED 以外かつ取り消しでもない）は従来どおり 400（fail-closed維持）。
- 既存の値あり(INTERESTED/WANT_TO_APPLY)の upsert＋タスク生成は1行も変えていない。取り消し時はタスク再生成しない。

```typescript
const isClear =
  response === null || response === undefined || response === "" ||
  response === "none" || response === "NONE";

const validResponses = ["WANT_TO_APPLY", "INTERESTED"];
if (!isClear && !validResponses.includes(response as string)) {
  return NextResponse.json({ error: "Invalid response value" }, { status: 400 });
}
// ...候補者解決（従来と同一ロジック）...
if (isClear) {
  const deleted = await prisma.candidateJobResponse.deleteMany({
    where: { candidateId: candidate.id, externalJobId: jobId },
  });
  return NextResponse.json({ success: true, cleared: true, deletedCount: deleted.count });
}
```

---

## 2. Phase 2: 対象外(EXCLUDED)とお気に入りの同期

### 経路調査の結論（コード事実）

| 経路 | portal への到達 | 対応 |
|---|---|---|
| portal 紹介リスト削除（`job-introductions` DELETE） | portal 起点（portal が job_id を把握） | ✅ ブックマークarchive実装 |
| /v/ 上の対象外操作 | **無し**（kyuujin→portal webhookは存在しない） | ❌ 実装不可＝報告 |
| /site/ 上の対象外操作 | **無し** | ❌ 報告 |
| kyuujin 管理画面からの除外 | **無し** | ❌ 報告 |

kyuujin backend の `PUT /api/external/mypage/jobs/feedback-status`（EXCLUDED セット）・`jobs/hide`・`jobs/restore` は**すべてローカルDB更新のみ**で portal への通知を一切行わない。kyuujin→portal の送信は `portal_service.py` の3種（candidate-birthday/summary の取得、submit時のcandidate-response送信）のみで、**EXCLUDED起因の送信は皆無**。したがって kyuujin側で起きた対象外はリアルタイムには同期不能（残骸は §3-b のバックフィル＋定期リコンサイルで回収）。

### 実装（到達経路=portal起点DELETE）

`src/app/api/candidates/[candidateId]/job-introductions/route.ts`:
- EXCLUDED を kyuujin へ push 成功後、`archiveBookmarksForExcludedJobs()` を best-effort（例外は握り潰し・除外本体を失敗させない）で実行。
- 突合は既存 restore-jobs と同一（`stripFileMetadata(fileName) === normalizeKyuujinCompanyName(company_name)`）。
- **安全ガード**: 「除外後も同一正規化名のアクティブ求人が残る会社」はarchiveしない（重複導入で片方だけ除外された場合に、生きている求人のブックマークを消さない）。archivedReason="job-excluded-sync"。

`src/app/api/candidates/[candidateId]/bookmarks/restore-jobs/route.ts`:
- 復帰(un-exclude)時、`archivedReason="job-excluded-sync"` で自動archiveしたブックマークのみ un-archive（archivedAt=null）。手動archiveには触れない。復帰会社の正規化名で突合。

---

## 3. Phase 3: 残骸バックフィル（dry-run→rollback CSV→ID限定実行）

### 3-a. 気になる残骸の再同期 — `scripts/t128-cleanup-stale-responses.ts`

**正データ源（重要）**: 各候補者について mypage admin エンドポイント（token取得→`/api/external/mypage/{token}?admin=true`）を叩き、
- `feedbacks` 辞書（JobFeedback: interested/apply/none）＝候補者の生トグル
- `jobs[].feedback_status`（resolved）＝可視性(EXCLUDED)判定
を併用。

**判定**（求人が可視かつ候補者の生feedbackがアクティブな時のみ keep）:
- 求人消失(MISSING) / EXCLUDED → 候補者に不可視 → stale
- feedback none/未設定 → 候補者がOFF → stale（本バグの本体）
- 生feedbackアクティブだが portal 値が違う → drift（**削除せず**報告のみ）
- 逆方向（kyuujinアクティブだがportalに無い）→ 削除せず件数のみ報告

**dry-run結果（2026-07-03）**:
```
Total CandidateJobResponse: 1061 / 123候補者
stale（削除対象）: 208 件 / 52 候補者
  理由内訳: EXCLUDED=90, CLEARED(PENDING)=63, CLEARED(UNANSWERED)=27,
           CLEARED(SELECTION_ENDED)=19, CLEARED(IN_SELECTION)=8, CLEARED(APPLY)=1
値ドリフト（報告のみ）: 2 件（5004411）
逆方向 missing（報告のみ）: 1 件
[検証] 5008089 の stale: 3 件 job=7708,7726,7727（すべて CLEARED(UNANSWERED)）
```
rollback CSV: `verify/t128-stale-responses-rollback-2026-07-03.csv`（208行・全列）
drift CSV: `verify/t128-stale-responses-drift-2026-07-03.csv`（2行）

### 3-b. 対象外済み求人の残留ブックマーク掃除 — `scripts/t128-archive-excluded-bookmarks.ts`

**安全ルール**: archive対象は「正規化名がEXCLUDED求人にマッチ、**かつ**同名のアクティブ求人が存在しない」ブックマークのみ。「EXCLUDEDにもアクティブにもマッチ（＝重複導入で片方生存）」は AMBIGUOUS として**触らない**。突合キーは restore-jobs と同一。

**dry-run結果（2026-07-03）**:
```
Total active BOOKMARK: 4614 / 212候補者
archive対象（EXCLUDEDのみ・重複なし）: 297 件 / 43 候補者
ambiguous（重複あり・触らない）: 140 件
[検証] 5008089: archive=0 / ambiguous=0  ← favoritesは15のまま（重複導入のため）
[検証] 5008086: 36求人中EXCLUDED22(別会社)→archive22 / 14はアクティブ求人にマッチしkeep
```
rollback CSV: `verify/t128-excluded-bookmarks-rollback-2026-07-03.csv`（297行）
ambiguous CSV: `verify/t128-excluded-bookmarks-ambiguous-2026-07-03.csv`（140行・触らない）

---

## 4. 検証（実測）

<!-- 実行後に追記 -->
（バックフィル実行・デプロイ後に追記）

---

## 5. コミット / デプロイ

<!-- 実行後に追記 -->
