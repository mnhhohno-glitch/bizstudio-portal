# T-128 マイページ件数不一致3件の原因特定（候補者5008089 大森成日）

調査日: 2026-07-03 ／ 対象: bizstudio-portal + bizstudio-mypage + kyuujin-pdf-tool ／ DB: SELECT のみ

---

## 症状の再確認（DB実数で検証済み）

| 画面 | 表示 | DB実数 |
|---|---|---|
| portal 候補者詳細の求人リスト | 「気になる」バッジ約7件 | CandidateJobResponse: 7レコード（全 INTERESTED） |
| 旧マイページ /v/（管理者プレビュー） | 全24件（未回答11・気になる4・対象外9） | kyuujinPDF jobs: 24件（UNANSWERED=11, INTERESTED=4, EXCLUDED=9） |
| 新サイト /site/ 担当CAからの求人 | 計15件（未回答11・気になる4・対象外0） | 24 − EXCLUDED 9 = 15 |
| 新サイト /site/ お気に入りバッジ | 15 | CandidateFile(BOOKMARK, archivedAt=null): 15件 |

---

## 1. 対象外9件が /site/ で消える原因

### DB実数

kyuujinPDF API（`GET /api/external/mypage/{token}?admin=true`）の全24件の feedback_status 内訳:

| feedback_status | 件数 | job_id 一覧 |
|---|---|---|
| UNANSWERED | 11 | 7708, 7710, 7712, 7713, 7716, 7722, 7723, 7724, 7725, 7726, 7727 |
| INTERESTED | 4 | 7706, 7718, 7720, 7728 |
| EXCLUDED | 9 | 7705, 7707, 7709, 7711, 7714, 7715, 7717, 7719, 7721 |

EXCLUDED 9件は全て `excluded_by="ca"`, `excluded_at=2026-06-25T12:35:48`（CA が一括除外）。

### コード転記: kyuujinPDF のフィルタロジック

**`kyuujin-pdf-tool/backend/app/routers/mypage.py` L812-870:**

```python
@router.get("/{token}", response_model=MypageDataResponse)
async def get_mypage_data(
    token: str,
    admin: bool = Query(False, ...),
    x_api_secret: Optional[str] = Header(None, alias="x-api-secret"),
    ...
):
    # 通常モードは EXCLUDED を除外
    if not is_admin:
        job_stmt = job_stmt.where(Job.feedback_status != "EXCLUDED")
```

- **admin=true + x-api-secret 一致**: 全件返却（EXCLUDED 含む）→ /v/ 管理者プレビューが使用 → 24件
- **admin=false（デフォルト）**: `feedback_status != 'EXCLUDED'` でフィルタ → 15件

### /site/ のデータ取得経路

/site/ のフロントエンドコードはローカルリポジトリ群で特定できなかった（デプロイ先のみに存在する可能性）。ただし、/site/ が表示する15件（= 24 − EXCLUDED 9）は kyuujinPDF API を **admin=false**（通常モード）で呼び出した結果と完全一致する。

### /v/ との差異（7タブ vs 5タブ）

| ステータス | /v/ 管理者プレビュー | /site/ 担当CAからの求人 |
|---|---|---|
| 未回答 (UNANSWERED) | ✓ 表示 | ✓ 表示 |
| 気になる (INTERESTED) | ✓ 表示 | ✓ 表示 |
| 応募したい (APPLY) | ✓ 表示 | ✓ 表示 |
| 保留 (PENDING) | ✓ 表示 | ✓ 表示 |
| 対象外 (EXCLUDED) | ✓ 表示（admin=true） | ✗ **APIレベルで除外** |
| 選考中 | ✓ タブ存在（0件） | ✗ |
| 選考終了 | ✓ タブ存在（0件） | ✗ |

### 原因の結論

/site/ が kyuujinPDF API を通常モード（admin=false）で呼び出しているため、EXCLUDED ジョブが API レスポンスに含まれない。UI 側の変換テーブルの問題ではなく、**データソースのフィルタが原因**。

### 修正候補

| ファイル | 修正内容 |
|---|---|
| `/site/` のデータ取得層（リポジトリ未特定） | kyuujinPDF API 呼び出し時に admin=true + x-api-secret を付与して EXCLUDED を含める |
| `kyuujin-pdf-tool/backend/app/routers/mypage.py` L866-870 | **代替案**: 新パラメータ `include_excluded=true` を追加し、admin 権限なしでも EXCLUDED を含めて返せるようにする（admin は閲覧回数等の追加情報を含むため、EXCLUDED 表示だけのために admin 権限を渡すのは過剰） |

**影響範囲**: EXCLUDED ジョブを持つ**全候補者**に影響。対象外を /site/ で表示しない限り、候補者は「なぜ求人が減ったか」を把握できない。

---

## 2. お気に入り15件の由来

### DB実数

**CandidateFile (5008089, category=BOOKMARK, archivedAt IS NULL): 15件**

全件 `origin=null`（= CA追加）。候補者本人追加（origin="candidate"）は 0件。

| # | file_name | sourceType | externalJobRef | kyuujinPDF 対応 |
|---|---|---|---|---|
| BM0 | 求人票_日本カノマックス株式会社_2026...723.pdf | null | null | job 7727 (UNANSWERED) |
| BM1 | 求人票_中沢乳業株式会社_2026...538.pdf | null | null | job 7723 (UNANSWERED) |
| BM2 | 求人票_阪神動力機械株式会社_2026...780.pdf | null | null | job 7725 (UNANSWERED) |
| BM3 | 求人票_株式会社巴製作所_2026...297.pdf | null | null | job 7724 (UNANSWERED) |
| BM4 | 求人票_株式会社ニレコ_2026...982.pdf | null | null | job 7728 (INTERESTED) |
| BM5 | 求人票_ＦＣＭ株式会社_2026...152.pdf | null | null | job 7726 (UNANSWERED) |
| BM6 | 株式会社オープンハウスグループ_No44673.pdf | null | null | job 7719 (**EXCLUDED**) |
| BM7 | 株式会社エコリング_No433961.pdf | null | null | job 7705 (**EXCLUDED**) |
| BM8 | 株式会社ONE_No449114.pdf | null | null | job 7717 (**EXCLUDED**) |
| BM9 | Care Earth株式会社_No407108.pdf | null | null | job 7714 (**EXCLUDED**) |
| BM10 | 不二サッシリニューアル株式会社_No191323.pdf | null | null | job 7715 (**EXCLUDED**) |
| BM11 | 株式会社八百鮮_No285065.pdf | null | null | job 7707 (**EXCLUDED**) |
| BM12 | 株式会社日立プラントサービス_No91084.pdf | null | null | job 7709 (**EXCLUDED**) |
| BM13 | 株式会社貴瞬_No417030.pdf | null | null | job 7711 (**EXCLUDED**) |
| BM14 | 株式会社レオパレス21_No308801.pdf | null | null | job 7714 (**EXCLUDED**) |

**15件の内訳: 6件 = 非EXCLUDED 求人のブックマーク、9件 = EXCLUDED 済み求人のブックマーク。**

別途、アーカイブ済み BOOKMARK が 6件存在（archived_at IS NOT NULL）。

### コード転記: favorites GET の抽出条件

**`src/app/api/external/candidate-site/favorites/route.ts` L72-87:**

```typescript
const files = await prisma.candidateFile.findMany({
  where: { candidateId: candidate.id, category: "BOOKMARK", archivedAt: null },
  ...
  orderBy: { createdAt: "desc" },
});
```

抽出条件: `candidateId + category=BOOKMARK + archivedAt IS NULL` の**全件**。kyuujinPDF 側の feedback_status は参照しない。origin（CA追加/本人追加）も区別せず全件返す。

### 判定

**T2 設計どおり**（favorites = CandidateFile BOOKMARK, not archived）。意図的にシンプルな抽出。

ただし以下の問題がある:
- EXCLUDED された求人の BOOKMARK もお気に入りに出る → 候補者にとって「CA が除外した求人」が「お気に入り」に表示される混乱
- CA 追加分（origin=null, 15件）が全てお気に入りバッジにカウントされる → 候補者が自分で追加した件数（0件）と一致しない

### 修正選択肢（実装しない・整理のみ）

| 選択肢 | 内容 | メリット | デメリット |
|---|---|---|---|
| A. バッジは本人追加のみカウント | `origin="candidate"` のみバッジ表示。CA追加は「担当CAのおすすめ」ラベルで区別 | 候補者の操作と一致 | CA追加の求人が目立たなくなる |
| B. EXCLUDED ブックマークを除外 | kyuujinPDF feedback_status と突合し EXCLUDED を favorites から除外 | 不要な求人が消える | favorites API が kyuujinPDF 依存になる（現在は portal DB のみ）|
| C. 現状維持 | 全 BOOKMARK を表示 | 変更なし | EXCLUDED 求人の混在 |

**推奨: B**（EXCLUDED ブックマークは候補者に見せるべきでない）。実装は favorites API に kyuujinPDF 問い合わせを追加するか、EXCLUDED 時に portal 側の BOOKMARK を自動アーカイブする方式。

### 影響範囲（DB実数）

| 指標 | 値 |
|---|---|
| 全候補者の BOOKMARK 件数（active） | 4,614件（212候補者） |
| うち origin="candidate"（本人追加） | 1件（1候補者） |
| うち origin=null（CA追加） | 4,613件（212候補者） |

---

## 3. Portal の気になる≒7件 vs kyuujinPDF の気になる4件

### DB実数

**Portal CandidateJobResponse（5008089）: 7レコード、全て response="INTERESTED":**

| externalJobId | responded_at | kyuujinPDF feedback_status | kyuujinPDF JobFeedback.status | 不整合 |
|---|---|---|---|---|
| 7706 | 2026-06-25T10:08:05 | INTERESTED | interested | ✓ 一致 |
| 7718 | 2026-06-28T14:56:36 | INTERESTED | interested | ✓ 一致 |
| 7720 | 2026-06-25T10:02:41 | INTERESTED | interested | ✓ 一致 |
| 7728 | 2026-06-25T10:02:45 | INTERESTED | interested | ✓ 一致 |
| **7708** | 2026-06-25T10:02:49 | **UNANSWERED** | **none** | **✗ 不整合** |
| **7726** | 2026-06-25T10:02:43 | **UNANSWERED** | **none** | **✗ 不整合** |
| **7727** | 2026-06-25T10:02:45 | **UNANSWERED** | **none** | **✗ 不整合** |

**差分3件（7708, 7726, 7727）**: kyuujinPDF 側では `feedback_status=UNANSWERED` + `JobFeedback.status="none"`（= 一度「気になる」にした後「none」に戻した）。Portal 側では `INTERESTED` のまま残存。

### コード転記: 同期の仕組みと障害箇所

#### (1) トグル ON（interested → portal へ送信）

**`bizstudio-mypage/src/hooks/useMypage.ts` L180-195:**
```typescript
const sendCandidateResponse = useCallback(
  (jobId: number, newStatus: FeedbackStatus) => {
    const response =
      newStatus === "apply" ? "WANT_TO_APPLY" :
      newStatus === "interested" ? "INTERESTED" :
      null;     // ← "none" の場合は null
    mypageApi.sendCandidateResponse(candidateNo, jobId, response).catch(...);
  }, ...
);
```

**`bizstudio-mypage/src/lib/api.ts` L86-97:**
```typescript
sendCandidateResponse: async (candidateId, jobId, response) => {
  await axios.post("/api/candidate-response", {
    candidateId, jobId, response,     // ← null がそのまま送信される
    respondedAt: new Date().toISOString(),
  });
},
```

#### (2) Portal webhook 受信側（**ここで拒否される**）

**`src/app/api/external/candidate-response/route.ts` L22-36:**
```typescript
if (!candidateId || !jobId || !response) {        // ← !null = true → 400
  return NextResponse.json(
    { error: "Missing required fields" }, { status: 400 }
  );
}

const validResponses = ["WANT_TO_APPLY", "INTERESTED"];
if (!validResponses.includes(response)) {          // ← null はここにも到達しない
  return NextResponse.json(
    { error: "Invalid response value" }, { status: 400 }
  );
}
```

#### (3) 同期フロー図

```
/v/ で「気になる」ON
  └→ kyuujinPDF: JobFeedback.status = "interested"  ✓
  └→ mypage → portal: response="INTERESTED" → upsert CandidateJobResponse ✓

/v/ で「気になる」OFF
  └→ kyuujinPDF: JobFeedback.status = "none"  ✓
  └→ mypage → portal: response=null → 400 "Missing required fields" ✗ （静かに握り潰し）
  └→ Portal CandidateJobResponse: INTERESTED のまま残存
```

**同期方向**: /v/ → portal は**一方向・追加のみ**。「取り消し」の同期メカニズムが存在しない。

**逆方向（portal → kyuujinPDF）の同期**: 存在しない。Portal の CandidateJobResponse はパッシブな受信記録のみ。

### 原因の結論

Portal の webhook ハンドラ（`/api/external/candidate-response`）が `response=null`（= トグル解除）を**必須フィールド不足として 400 で拒否**する。mypage 側は `.catch()` で握り潰す。結果として CandidateJobResponse テーブルに stale な INTERESTED レコードが残存する**同期バグ**。

### 修正候補

| ファイル | 修正内容 |
|---|---|
| `src/app/api/external/candidate-response/route.ts` L22-36 | `response=null` を受け付け、該当 CandidateJobResponse を**削除**（または response を "NONE" に更新）する分岐を追加 |
| `bizstudio-mypage/src/hooks/useMypage.ts` L188 | **代替案**: `null` ではなく明示的な文字列 `"NONE"` を送信。portal 側で validResponses に "NONE" を追加し、CandidateJobResponse を削除 |

**推奨修正**: portal 側で `response=null` → `DELETE CandidateJobResponse` 分岐を追加（mypage 側の変更不要。null をそのまま送信する現行コードで動作）。

### 影響範囲（DB実数）

| 指標 | 値 |
|---|---|
| CandidateJobResponse 全レコード数 | 1,061件 |
| 対象候補者数 | 123人 |
| 内訳: INTERESTED | 533件 |
| 内訳: WANT_TO_APPLY | 528件 |

このうち kyuujinPDF 側で既に "none" に戻されたレコード（stale）の正確な件数は、kyuujinPDF DB と portal DB のクロスジョインが必要なため本調査では概算不可。5008089 のケース（7件中3件 = 43% が stale）が典型的なら、全体で**数百件規模の stale レコード**が存在する可能性がある。

---

## 4. 修正提案のまとめ

| # | 症状 | 原因 | 修正箇所 | リスク | 優先度 |
|---|---|---|---|---|---|
| 1 | 対象外9件が /site/ で消える | kyuujinPDF API が非admin モードで EXCLUDED を除外 | /site/ データ取得層（リポジトリ未特定）+ kyuujin-pdf-tool mypage.py | 全候補者に影響。修正は API パラメータ追加のみで既存動作に副作用なし | 高 |
| 2 | お気に入りバッジ15件 | favorites API が EXCLUDED 求人の BOOKMARK も含む | `src/app/api/external/candidate-site/favorites/route.ts` | 212候補者に影響しうるが、現時点で本人追加は1件のみ（実害は限定的） | 中 |
| 3 | portal 気になる7 vs kyuujinPDF 4 | webhook が response=null を拒否 → 取り消し同期不可 | `src/app/api/external/candidate-response/route.ts` | 123候補者に潜在影響。修正は null ハンドリング追加のみ。既存の INTERESTED/WANT_TO_APPLY 処理に影響なし | 高 |

### 補足: 5008089 の EXCLUDED 9件と非 EXCLUDED 15件の関係

EXCLUDED 9件は全て `_No{数字}` 形式の会社名（旧 Circus/agentbank 番号付き）で、同一の会社が `_No` なし（または `_タイムスタンプ` 形式）で非 EXCLUDED として別途存在する。つまり **9件は重複求人として CA が意図的に除外**したもの。対応する BOOKMARK が portal に残っているのは「除外時に BOOKMARK をアーカイブする連携がない」ため。

| EXCLUDED job | 対応する非EXCLUDED job |
|---|---|
| 7705 エコリング_No433961 | 7713 エコリング |
| 7707 八百鮮_No285065 | 7712 八百鮮 |
| 7709 日立プラント_No91084 | 7718 日立プラント (**INTERESTED**) |
| 7711 貴瞬_No417030 | 7716 貴瞬 |
| 7714 Care Earth_No407108 | 7720 Care Earth (**INTERESTED**) |
| 7715 不二サッシ_No191323 | 7706 不二サッシ (**INTERESTED**) |
| 7717 ONE_No449114 | 7722 ONE |
| 7719 オープンハウス_No44673 | 7708 オープンハウス |
| 7721 レオパレス_No308801 | 7710 レオパレス |

---

## 付録: feedback_status の全体像

### kyuujinPDF 側の定義

**`kyuujin-pdf-tool/backend/app/models/job.py` L9-11:**
```python
FEEDBACK_STATUS_VALUES = {"UNANSWERED", "INTERESTED", "APPLY", "PENDING", "EXCLUDED"}
EXCLUDED_ACTOR_VALUES = {"user", "ca"}
```

### 解決関数

**`kyuujin-pdf-tool/backend/app/routers/mypage.py` L45-55:**
```python
def _resolve_feedback_status(job: Job, feedbacks_dict: dict) -> str:
    current = job.feedback_status or "UNANSWERED"
    if current != "UNANSWERED":
        return current
    legacy = feedbacks_dict.get(job.id)
    if legacy == "interested":
        return "INTERESTED"
    if legacy == "apply":
        return "APPLY"
    return "UNANSWERED"
```

### Portal → kyuujinPDF のステータス変換

**`kyuujin-pdf-tool/backend/app/services/portal_service.py` L12-15:**
```python
_STATUS_MAP = {
    "apply": "WANT_TO_APPLY",
    "interested": "INTERESTED",
}
```

---

*本報告は調査のみ。コード変更・DB書き込みは実施していない。*
