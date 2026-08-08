# T-152 / T-153 合同 Phase 1 調査 — analyze-with-intake の2つの既存不具合

調査日: 2026-08-02 / 対象: bizstudio-portal（主）+ candidate-intake（読み取りのみ） / master worktree
**実施範囲: 調査のみ。アプリコードは1行も変更していない。本番DBは SELECT のみ。**

- **T-152**: 解析対象ログを interviewId で絞っておらず「求職者の最新 MEETING txt」を使う
- **T-153**: PDFのみ添付（txt無し）で解析すると 502

いずれも T-151 が作った不具合ではなく、両エンドポイントの**初版から存在する**（項目7参照）。

---

## 0. サマリ（先に結論）

| # | 論点 | 結論 |
|--|--|--|
| ★ | **T-152 の本質** | 「最新を選んでいる」のが問題なのではなく、**`CandidateFile` に面談への紐付けカラムが存在しない**。interviewId で絞る材料が現状どこにもない。添付タブ自体が求職者スコープで、全面談で同じ一覧を表示している |
| ★ | 実測の深刻度（T-152） | txtを持つ求職者の面談 699件のうち、**当該面談のログが使われているのは 225件（32%）だけ**。txt複数の求職者に限ると **191/245（78%）が別面談のログ** |
| ★ | **T-153 の原因** | portal が `interviewLog \|\| " "`（空白1文字）を送り、candidate-intake が `.trim() === ""` で 400。**両者とも初版からこの組み合わせ**で、PDF単独解析は一度も成立していない |
| ★ | 実測の深刻度（T-153） | 解析ボタンが出る 564名のうち **276名（49%）が PDFのみ＝押すと必ず502**。該当面談 125件 |
| 6 | 用途別に入力を変えられるか | **変えられる**。upstream 呼び出し（PDF＋ログ）と T-151 検出（ログのみ）は既に別変数・別処理で分離済み。ファイル選択を2系統に分けるのは局所改修で済む |
| 12 | 修正箇所の重複 | **同一ファイル・近接行に入る**（`analyze-with-intake/route.ts` L56-132）。並行実装するとコンフリクト確実 → 直列で実装する |
| — | T-153 推奨 | **案B'（portal 側でPDF単独時の送信内容を変える）+ 案A の併用**。candidate-intake は触らない |
| — | T-152 推奨 | **案B（interviewId 優先・無ければフォールバック）+ 用途別分離**。ただし紐付けカラム新設が前提 |

---

## 1. ルートハンドラの構造

`src/app/api/interviews/[id]/analyze-with-intake/route.ts`（239行 / `maxDuration = 300`）

### 1-1. 解析対象ファイルの選択ロジック（L56-75）

```ts
const meetingFiles = await prisma.candidateFile.findMany({
  where: {
    candidateId: record.candidate.id,   // ★求職者スコープ。interviewId は条件に入っていない
    category: "MEETING",
    archivedAt: null,
  },
  orderBy: { createdAt: "desc" },       // ★最新が先頭
});
const txtFiles = meetingFiles.filter(isTxt);
const pdfFiles = meetingFiles.filter(isPdf);
```

| 項目 | 内容 |
|--|--|
| テーブル | `candidate_files`（`CandidateFile`） |
| 条件 | `candidate_id` + `category='MEETING'` + `archived_at IS NULL` |
| 並び順 | `created_at DESC` → **`txtFiles[0]` / `pdfFiles[0]` の先頭1件だけを使う**（L87, L100） |

### 1-2. 「MEETING txt」の判定条件（L66-69）

**カラムではなく MIME と拡張子の OR 判定。**

```ts
const isTxt = (f) => f.mimeType.startsWith("text/") || f.fileName.toLowerCase().endsWith(".txt");
const isPdf = (f) => f.mimeType === "application/pdf" || f.fileName.toLowerCase().endsWith(".pdf");
```

`CandidateFile` に「これは面談ログである」ことを示す専用カラムは無い（`category='MEETING'` はファイルの置き場所の区分であって、面談との紐付けではない）。

### 1-3. upstream へ送るペイロード（L121-132）

```ts
POST {intakeUrl}/api/portal/analyze-interview
headers: { "Content-Type": "application/json", "x-portal-secret": secret }
body: {
  pdfBuffer:       pdfBuffer || "IA==",        // "IA==" = base64(" ")
  interviewLog:    interviewLog || " ",        // ★T-153 の原因
  candidateNumber: record.candidate.candidateNumber || "0000000",
}
```

送るのは **この3フィールドのみ**。interviewId・面談日・面談回数は一切送っていない。

### 1-4. エラー経路（502 がどこで出るか）

| 行 | 条件 | 返す |
|--|--|--|
| L27 | 未認証 | 403 |
| L33-39 | `PORTAL_SHARED_SECRET` 未設定 | 500 |
| L51-53 | 面談レコード無し | 404 |
| L77-82 | txt も pdf も0件 | 400「Nottaログ(.txt)または履歴書PDFを添付してください」 |
| L94-97 / L107-110 | Drive ダウンロード失敗 | 500 |
| L113-118 | 両方とも中身が空 | 500 |
| **L136-143** | **upstream が非2xx** | **502「解析サービスエラー (＜upstreamのstatus＞): ＜message＞」** ←★T-153 はここ |
| L146-151 | upstream が `success:false` | 500 |
| L232-237 | 想定外例外 | 500 |

**T-151 の検出コード（L195-222）は L136-143 より後段**にあるため、502 時には到達しない。

### 1-5. 副次的な発見（軽微・要修正）

L50 のコメントがずれている。T-151 Phase 2-4 で追加した
`// T-151: 破棄済みの面談では候補を出し直さない…` が `if (!record)` の直上に置かれており、実際の該当コードは L202。**動作影響はないがミスリードなので、T-152/T-153 の実装時に併せて移動すること。**

---

## 2. interviewId はルートに渡ってきているか → **渡ってきている**

```ts
const { id: interviewId } = await params;   // L41
```

既に `interviewDetail.findUnique({ where: { interviewRecordId: interviewId } })`（L163）と
`interviewRecord.update({ where: { id: interviewId } })`（L213）で使われている。
**呼び出し元から渡す改修は不要。** 問題は「interviewId で絞る先のカラムが無い」ことのみ（項目3参照）。

呼び出し元 `InterviewForm.tsx` L941:
```ts
fetch(`/api/interviews/${interviewId}/analyze-with-intake`, { method: "POST", body: JSON.stringify({ candidateId }) })
```
（body の `candidateId` はサーバー側では未使用。サーバーは面談レコードから引き直している）

---

## 3. 同一求職者に面談ログtxtが複数存在するケース（実測）

**★その前に、より重大な構造的事実:**

`CandidateFile` に **`interviewRecordId` 等の面談紐付けカラムは存在しない**（`prisma/schema.prisma` の `model CandidateFile` に interview 関連フィールドは0件）。さらに:

- 添付タブの一覧は `GET /api/candidates/{candidateId}/files?category=MEETING`（`InterviewForm.tsx` L773-783）＝**求職者スコープ**。同じ求職者ならどの面談を開いても**同一の添付一覧**が出る。
- アップロード先も `POST /api/candidates/{candidateId}/files/upload`（同 L787-800）で **interviewId を送っていない**。

→ **「どの面談のログか」という情報は、そもそもどこにも記録されていない。**

### 実測値（2026-08-02 / 本番）

| 指標 | 件数 |
|--|--|
| MEETING txt を持つ求職者 | **288** |
| うち **txt が2件以上**の求職者 | **72** |
| MEETING txt 総数 | 377 |
| 面談を持つ求職者 | 3,017 |
| 面談総数 | 5,315 |
| 面談2件以上 **かつ** txt2件以上の求職者 | 68 |

---

## 4. 「最新txtが最新面談のものではない」ケースは実在するか → **実在する（むしろ多数派）**

紐付けが無いため、**アップロード日時と面談日の差**で判定した（±1日以内なら当該面談のログとみなす）。

| 区分 | 件数 | 割合 |
|--|--|--|
| txtを持つ求職者の面談 総数 | **699** | 100% |
| 使用txtが面談日の**±1日以内**（当該面談のログとみなせる） | **225** | **32%** |
| 使用txtが面談日より1日以上**後**（＝**後の面談のログ**を使う） | **231** | 33% |
| 使用txtが面談日より1日以上**前**（＝当該面談のログでない／未アップ） | **243** | 35% |

**txt が2件以上の求職者に絞ると:**

| 区分 | 件数 | 割合 |
|--|--|--|
| 対象面談 | 245 | 100% |
| **別面談のログが使われる（±1日外）** | **191** | **78%** |

→ T-152 は理論上の懸念ではなく、**実データで常態化している**。

---

## 5. 面談にtxtが1件も紐づいていないケース → **大多数**

| 指標 | 件数 |
|--|--|
| 面談があるが MEETING txt が0件の求職者 | **2,730** |
| その求職者が持つ面談 | **4,616**（全5,315面談の **87%**） |
| MEETING 添付そのものが0件の求職者の面談 | 4,491（解析ボタン自体が出ない） |

→ **interviewId で厳格に絞る変更（案A）を入れると、紐付けが無い既存データは全滅する。** 紐付けカラムを新設しても、既存の377件のtxtに遡って面談を割り当てる作業（またはフォールバック）が必須。

### 参考: `InterviewAttachment` は代替の紐付けにならない

`interview_attachments` は `interview_record_id` を持つが、以下の理由で使えない。

| 指標 | 実測 |
|--|--|
| 総数 / うち txt | 841 / **235** |
| MEETING txt(377) のうち同名が存在する割合 | **101 / 377（27%）** |
| 直近90日の MEETING txt(286) のうち同名あり | 78 / 286（27%） |
| txt行の `uploaded_by` 内訳 | copy-prev=136、南條=21、大野=40、安藤=38 |
| **人手アップロードの最終日** | **2026-05-29**（T-067 で CandidateFile へ移行して以降ゼロ） |
| copy-prev の最終日 | 2026-07-29（＝**前回面談の添付を新面談へ自動コピー**するので、同じtxtが複数面談に付く） |

現在も動いている書き込みは `copyCandidateFilesToInterview`（`src/app/api/interviews/route.ts` L517-）だが、**コピー対象は `mimeType: "application/pdf"` のみ**でtxtは対象外。

---

## 6. ★用途別に入力を変えられる構造か → **変えられる（重要）**

現行コードは既に2系統に分かれている。

| 用途 | 使う入力 | 該当行 |
|--|--|--|
| 各カラムへの自動入力（情報更新） | `pdfBuffer` + `interviewLog` を upstream へ送る | L121-132 |
| **T-151 タスク検出** | **`interviewLog` のみ**（PDFは意図的に渡さない） | L205-208 |

`interviewLog` / `pdfBuffer` はローカル変数として独立しており、**それぞれに別のファイルを読み込ませることが可能**。

→ **推奨する設計:**
- **情報更新用**: 従来どおり「求職者の最新 MEETING txt/PDF」でよい（他面談のログでも情報の上書き先はCAが確認するため害が小さい。かつ既存87%の面談を壊さない）
- **タスク検出用**: **当該面談に紐づくログがある場合のみ**検出する（無ければ検出しない）。誤った面談の約束を起票するリスクを構造的に排除できる

この分離は `detectSuggestedTasksFromInterviewLog` に渡す変数を差し替えるだけで、**upstream 呼び出しには一切影響しない**。

---

## 7. `|| " "` が入っている理由 → **初版から。意図は「空を送らない」だが upstream 側と噛み合っていない**

```
$ git log -L 129,129:'src/app/api/interviews/[id]/analyze-with-intake/route.ts'
78ebb4c feat(api): 面談ログ解析Proxy API + WorkHistory CRUD API
+        interviewLog: interviewLog || " ",
```

**この行はエンドポイントの初版で追加されたまま一度も変更されていない。** コメントも無し。
`pdfBuffer: pdfBuffer || "IA=="` と対になっており（`IA==` は base64 の半角スペース）、
「**必須フィールドなので空文字ではなくダミーを入れて通す**」という意図だったと読める。

しかし upstream 側の判定は同じく初版から `.trim() === ""` を含んでいた（項目8）。
→ **両者は最初から矛盾しており、PDF単独解析は一度も成功したことがない。**

---

## 8. candidate-intake 側のバリデーション定義

**`specs/` ではなくコード側。** `C:\bizstudio\candidate-intake\src\app\api\portal\analyze-interview\route.ts` L207-209:

```ts
if (!interviewLog || typeof interviewLog !== "string" || (interviewLog as string).trim() === "") {
  return jsonError("interviewLog is required and must be a non-empty string", 400);
}
```

- 導入コミット: `e8a86a9 feat(api): Portal向け面談ログ解析エンドポイントを追加`（**初版**）
- 同じブロックに `pdfBuffer`（base64必須・デコード後0バイト禁止）と `candidateNumber`（数字のみ）の検証もある
- **`src/services/loadSpec.ts` / `geminiClient.ts` / `specs/` は変更禁止ファイルだが、この route.ts はそれらには含まれない**（ただし本チケットでは candidate-intake は触らない方針を推奨。項目「推奨修正方針」参照）

---

## 9. txt無し・PDFのみのとき、何を返すのが正しい仕様か → **PDFからの抽出だけ行うのが正**

根拠3点:

1. **portal 側の旧解析ルート（`/api/interviews/analyze`・現在は dead code）は PDF単独を明示的に許可していた**
   ```ts
   if (!transcript && !pdfFile && !interviewFile) {   // L197
     return NextResponse.json({ error: "テキストまたはPDFを入力してください" }, { status: 400 });
   }
   ```
   → txt か PDF の**どちらか**があれば通す設計。
2. **`analyze-with-intake` 自身も PDF単独を通す前提で書かれている**（L77-82 は「txt も pdf も0件」のときだけ 400）。つまり**portal の意図としては PDF単独は正常系**。
3. **プロンプト仕様（`specs/01_common_analysis_prompt.yaml`）も PDF単独抽出を想定した記述を持つ**
   - L2「準備する資料: 面談の通話文字起こしメモ / Web履歴書PDF（テキスト抽出済み）」
   - L44「入社年月・退職年月が **PDF から読み取れない場合は空文字**で返す」
   - L48-50「マイナビPDF等の希望条件欄を**最優先で抽出**。PDFに記載がない場合のみ面談ログから推論（フォールバック）」
   → **PDF が主・ログが補助**という構成で、ログが無くても成立する記述になっている。

→ **「txt必須」は仕様ではなく、upstream バリデーションの実装都合。**

---

## 10. 本番でこの502が過去どれくらい発生しているか → **ログからは測定不能。構造的な露出母数で代替**

`railway logs --service bizstudio-portal` は**現在のデプロイ分しか保持しておらず**（本日のリリース直後）、`analyze-with-intake` の行は0件だった。過去の発生回数は取得できない。

代わりに「押せば必ず502になる母数」を実測した。

| 指標 | 件数 |
|--|--|
| MEETING 添付を持つ求職者（＝**解析ボタンが表示される**母数） | **564** |
| うち **PDFのみ・txt無し（押すと必ず502）** | **276（49%）** |
| うち txt あり（正常に解析できる） | 288（51%） |
| PDFのみ求職者が持つ**面談件数** | **125** |
| 直近90日に MEETING ファイルが作られた PDFのみ求職者 | **268**（＝現在進行形で増えている） |

→ **解析ボタンが出る求職者のほぼ半数で、押すと必ず502になる。**

---

## 11. UI側で txt無しでも解析ボタンが押せるか → **押せる（PDF1件でも表示される）**

`src/components/candidates/InterviewForm.tsx` L1771:

```tsx
right={attachments.length > 0
  ? <BtnMini variant="ai" onClick={handleIntakeAnalyze} disabled={intakeAnalyzing}>
      {intakeAnalyzing ? "解析中..." : "✨ ログを解析して各カラムへ自動入力"}
    </BtnMini>
  : undefined}
```

- 条件は **`attachments.length > 0` のみ**。txt / pdf の区別をしていない。
- `attachments` は求職者の MEETING ファイル全部（L773-783）。**PDF1件だけでもボタンが出る。**
- 失敗時は `toast.error(err.error)` で「解析サービスエラー (400): interviewLog is required and must be a non-empty string」という**英語の内部エラーがそのままCAに見える**（L946-949）。

---

## 12. T-152 と T-153 の修正箇所は重なるか → **重なる。直列実装が必須**

| 対象 | T-152 | T-153 |
|--|--|--|
| `analyze-with-intake/route.ts` L56-75（ファイル選択） | **書き換える** | 参照する（txt有無の判定） |
| 同 L84-111（読み込み） | **書き換える** | 触る可能性あり |
| 同 L121-132（ペイロード） | 影響小 | **書き換える** |
| 同 L195-222（T-151 検出） | **書き換える**（用途別分離） | — |
| `InterviewForm.tsx` L1771 付近 | 表示情報の追加 | **ボタン活性/文言** |
| `prisma/schema.prisma` | **紐付けカラム新設** | — |

→ **同一ファイルの近接行に両方が入る。** 並行実装すればコンフリクト確実。**T-153 → T-152 の順に直列で実装すること**（理由は下記）。

---

## 推奨修正方針

### T-153: **案B'（portal 側でペイロードを変える）＋ 案A（UI ガード）の併用**

指示書の3案に対する評価:

| 案 | 評価 |
|--|--|
| A: txt無しなら解析ボタンを押させない | **単独では不可**。276名（49%）が「解析できない」状態に固定される。PDF単独解析は本来の仕様（項目9）なので機能を殺すことになる。ただし**併用する価値はある**（後述） |
| B: candidate-intake のバリデーションを緩める | **非推奨**。他リポジトリの変更＝デプロイ・検証コストが増える。`analyze-interview` は portal 専用エンドポイントなので緩めても実害は小さいが、**portal 側だけで直せるものを他リポに波及させない**方がよい |
| C: PDF専用の解析モードで呼ぶ | **非推奨**。新モード＝新プロンプト＝**Gemini コール増**の方向。月次上限保護に反する |

**推奨（B'）**: candidate-intake は触らず、**portal 側で「ログが無い」ことを伝える非空文字列を送る**。

```ts
// 現状
interviewLog: interviewLog || " ",
// 案B'
interviewLog: interviewLog || "（面談ログの添付なし。履歴書PDFのみから抽出してください）",
```

- `.trim() !== ""` を満たすのでバリデーションを通過する
- **Gemini コールは1回も増えない**（同じ1コールの入力文字列が変わるだけ）
- プロンプトは「PDF主・ログ補助」構成（項目9）なので、この一文でPDF単独抽出として成立する
- **1行の変更で 276名分が解消する**

**併せて案Aの一部を入れる**:
- ボタンは押せるままにし、**ラベルを状況で出し分ける**（txtあり=「✨ ログを解析して各カラムへ自動入力」/ PDFのみ=「✨ 履歴書PDFから各カラムへ自動入力」）
- 502 時の `toast` に英語の内部エラーをそのまま出さない（L946-949）

⚠️ **検証条件**: 案B' はプロンプト入力を変えるため、**staging で PDF単独解析の出力品質を必ず確認する**こと（抽出項目が空だらけにならないか）。ここが Phase 2 の主な検証ポイント。

### T-152: **案B（interviewId 優先・無ければフォールバック）＋ 用途別分離**

指示書の案に対する評価:

| 案 | 評価 |
|--|--|
| A: interviewId 厳格絞り | **不可**。紐付けカラムが無く、既存の面談 4,616件（87%）とtxt 377件すべてが紐付け無し。厳格化した瞬間に解析機能が事実上停止する |
| B: interviewId 優先・無ければ従来フォールバック+画面明示 | **推奨** |
| 用途別に分ける | **推奨（Bと併用）**。項目6のとおり構造的に可能 |

**推奨構成:**

1. **`CandidateFile` に `interviewRecordId String?`（nullable）を新設**（純粋追加）。
   アップロード API（`/api/candidates/[candidateId]/files/upload`）が **面談画面からの場合のみ** interviewId を受けて記録する。既存行は NULL のまま＝挙動不変。
2. **情報更新（upstream 呼び出し）**: 「当該面談に紐づくtxt → 無ければ求職者の最新txt」のフォールバック。既存データを壊さない。
3. **タスク検出（T-151）**: **当該面談に紐づくtxtがある場合のみ実行**。無ければ検出しない（誤起票を構造的に排除）。
4. **画面明示**: 解析結果に「使用したログのファイル名とアップロード日」を返し、カード／トーストに出す。他面談のログを使った場合はCAが気づける。

⚠️ この案では、紐付けが貯まるまで（＝今後アップロードされる分から）タスク検出が働かなくなる面談が出る。**T-151 の検出頻度が一時的に下がる**点は運用と合意が必要。
代替として「±1日以内のtxtを当該面談のものとみなす」ヒューリスティックで既存分を救うことも可能だが、実測で ±1日以内は 225/699（32%）しかないため**過信は禁物**。

---

## 実装フェーズの推奨順序

| 順 | 内容 | 理由 |
|--|--|--|
| **1** | **T-153**（portal 1行 + UI 文言・エラー表示） | 影響範囲が最小・スキーマ変更なし・**276名/49%** に即効。T-152 の大改修前に済ませる |
| **2** | **T-152 step1**: `CandidateFile.interviewRecordId` 追加（nullable）+ アップロード時に記録 | 純粋追加で挙動不変。**紐付けデータが貯まり始める**のが早いほど後段が効く |
| **3** | **T-152 step2**: 解析ルートを用途別に分離（情報更新=フォールバックあり / タスク検出=紐付け必須） | step2 の効果は step1 のデータ蓄積に依存するため後 |
| **4** | **T-152 step3**: 使用ログの画面明示 | UI のみ。単独で戻せる |

**T-153 と T-152 を並行実装しない**こと（項目12）。1→2→3→4 の直列で、各段階を個別コミットにする。

デプロイ判断: **1 は staging 必須**（AI入力文字列が変わるため）。2 は nullable 追加のみで master 直 push 可だが、3 と同時に出すなら staging 経由。
