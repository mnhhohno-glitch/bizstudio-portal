# T-132: タイプ診断のおすすめ接続（診断直後の自動構造化＋過去バッチ＋seed③読み替え）

実装日: 2026-07-04 ／ 対象: bizstudio-portal（master・単一リポジトリで完結）
前提調査: `docs/reports/recommend-seed-diagnosis.md`（診断＝`advisor_chat_messages.content` に自由文・構造化0件・表記ゆれ実証）

---

## 結論

診断の自由文希望条件を **AI（Gemini）で後読み構造化 → 新テーブルに保存 → preferences③seed へ同形式で供給** する経路を実装・本番反映した。診断AIのプロンプト/SKILL は不変（診断体験ゼロ変更）。過去97候補者ぶんをバッチ構造化済み。

- コミット: `eff1a08`（実装）/ `60d705d`（maxOutputTokens修正）/ 本レポート（後述）
- Railway 本番（bizstudio-portal）: 両コミットとも **SUCCESS**（`prisma migrate deploy` でテーブル作成済み）
- バッチ結果: **97/97 保存**（初回93成功＋4失敗、token修正後に残4を再実行し全成功・冪等）

---

## Phase 1: 保存先スキーマと抽出処理

### 保存先（新テーブル `advisor_type_diagnosis`）

`prisma/migrations/20260704150000_t132_advisor_type_diagnosis/migration.sql`（純追加・既存非破壊）。
候補者1名につき最新診断1行（`candidate_id @unique`・再診断で upsert 上書き）。FK は張らない（`AdvisorUsageLog` と同方針・テストユーザー混在/ログ隔離）。

| 列 | 型 | 用途 |
|---|---|---|
| `candidate_id` | text UNIQUE | 候補者（FKなし） |
| `diagnosis_type` | text? | 6タイプ判定（取れた場合） |
| `desired_job_types` | text[] | 職種キーワード（原文のまま） |
| `desired_prefectures` | text[] | 都道府県名へ正規化済み |
| `desired_salary_min` | int? | 万円。**許容下限優先**（無ければ月給×12）。理想額は入れない |
| `desired_salary_max` | int? | 万円。許容上限 ?? 理想レンジ上限 |
| `ideal_salary_min/max` | int? | 理想額（**別枠**・seedのminには使わない） |
| `source_message_id` | text | 抽出元 `advisor_chat_messages.id`（冪等キー） |
| `raw_json` | jsonb | 抽出生JSON（監査用） |
| `extraction_model` / `extracted_at` | | 抽出モデル・日時 |

### 抽出処理（`src/lib/advisor/diagnosis-extract.ts`）

- モデル: 既存の安価設定を流用（`gemini-3-flash-preview` / `src/lib/ai/gemini-client.ts`）。temperature 0.1・responseSchema で構造化出力。
- コスト永続化: `AdvisorUsageLog`（endpoint=`diagnosis-extract`）に記録（Gemini usage を input/output にマップ・単価は `MODEL_PRICING_PER_MTOK` に概算追加）。

#### 採用ルール（表記ゆれ対処）

- **年収**（全て万円・年額に正規化。散文の「理想/許容下限/月給」を区別）:
  - `desiredSalaryMin` = **許容下限を最優先**採用。許容下限が無く月給のみ → **月給×12**。**理想額しか無い場合は min に入れない**（`ideal_salary_*` に別枠保管）。
  - `desiredSalaryMax` = 許容上限 ?? 理想レンジ上限（検索の上限ヒント。無害）。`min>max` の破綻は max を無効化（誤seed防止）。
  - 数値が曖昧/無い年収は全て null（誤った下限を作らない＝fail-safe）。
- **エリア**: 都道府県名の配列へ正規化（「愛知県内」→愛知県、「東京23区内」→東京都、「さいたま市」→埼玉県）。都道府県に落ちない曖昧表現（「関東」等）・除外指定県は含めない。
- **職種**: 診断の職種キーワードを原文のまま配列化（マスタ寄せなし）。避けるべき職種は入れない。
- **確信の持てない項目は null / 空配列**（fail-safe 優先）。

#### 発火点（診断完了直後・自動）

`src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/route.ts`。
assistant 応答を保存した直後、`isDiagnosisContent()`（`検索条件（推奨）` / `職種キーワード` を含む）が真なら
`runDiagnosisExtraction()` を **fire-and-forget**（await しない・`.catch` でログのみ）。
- 失敗は診断体験・チャット応答に一切影響しない（レスポンス本体 `saved` は不変）。
- portal は Railway 常駐 Node のためレスポンス返却後も継続実行される（Vercel lambda と異なる）。
- 取りこぼしは Phase 2 バッチが拾い直す。

---

## Phase 2: 過去バッチ構造化

スクリプト `scripts/backfill-diagnosis-extraction-t132.ts`（dry-run/execute・候補者ごと最新診断・冪等= `source_message_id` 一致でskip・失敗リスト出力）。

### dry-run 実測

```
診断メッセージ総数=111 / 対象候補者(distinct・最新採用)=97
既存 advisor_type_diagnosis 行=0 / 今回処理対象=97
概算: 入力~145,787tok / 出力~29,100tok / 費用~$0.1165（gemini-3-flash-preview概算）
```

### サンプル対比（原文の表記ゆれ → 構造化結果・DBには保存しない dry-run 検証）

3実例（前提調査§3）が正しく正規化されていることを含め、代表10件:

| # | 候補者 | 原文の要点（表記ゆれ） | 構造化結果（採用ルール適用後） |
|---|---|---|---|
| 1 | 5999998 佐藤葵 | エリア「東京都23区内」／許容下限450・理想480-550／職種「」括り | pref=[東京都] / min=450 max=550 ideal=480-550 / 職種6 |
| 2 | 5004272 伊野克美 | エリア第1埼玉〜第3神奈川千葉（茨城は現職**除外**）／許容下限450・理想500-600 | pref=[埼玉県,東京都,神奈川県,千葉県] / min=450 max=600 |
| 3 | 5008149 猪飼ふき | エリア「愛知県内」／許容下限180・**月給16-18万**・理想200-250／職種、区切り | pref=[愛知県] / min=180 max=250（月給誤採用なし） |
| 4 | 5008136 川崎優太 | 許容下限500・**月給35万**・理想600-800／エリア「東京23区内」 | pref=[東京都] / min=500 max=800（月給を年収minにしない） |
| 5 | （リサーチ職・ENDED） | エリア「JR中央線沿線…23区全域,横浜川崎」／許容下限380・理想420-550 | pref=[東京都,神奈川県] / min=380 max=550 |
| 6 | 5004225 伊藤健太 | 職種「未経験」系12語（S/A/B）／**年収記載なし・エリア記載なし** | 職種12 / pref=[] / min=null max=null（**fail-safe空**） |
| 7 | 5004316 安西夏樹 | 職種3優先度13語／エリア宮城中心＋登録地／許容下限は面談未確認 | pref=[宮城県,…] / min=450 max=550 |
| 8 | 5008008 平子翔大 | 許容下限520・理想700 | min=520 max=700 |
| 9 | 5008063 新山佳穂 | 許容下限300のみ（理想上限なし） | min=300 **max=null**（上限を捏造しない） |
| 10 | 5008117 中山ちはる | 職種5語・エリア複数（token修正後に成功） | min=300 max=450 pref=[東京都,神奈川県,埼玉県] |

→ **年収の「許容下限最優先／月給×12／理想額は別枠」** と **エリアの都道府県正規化** が全ケースで期待どおり。記載の無い項目は誤って埋めず null/空（fail-safe）。

### execute 実測

- 初回: **保存93 / no-signal 0 / 失敗4**（`Response is not valid JSON`）。
- 原因: `gemini-3-flash-preview` は thinking モデルで思考トークン(~1200-1350)が `maxOutputTokens=2048` を食い、職種配列が長い診断で出力が途中で切れ JSON 破損（finishReason=MAX_TOKENS 相当）。同一入力でも簡易スキーマなら STOP・4096 なら STOP を実測確認。
- 対処: `maxOutputTokens` を **6144** に増（コミット `60d705d`・発火点/バッチ共通）。
- 再実行（冪等・残件のみ）: 残4件のうち token 未修正時に2件成功、修正デプロイ後に残2件も成功 → **最終 97/97 保存・失敗0**。

---

## Phase 3: seed③への接続

`src/app/api/external/candidate-site/preferences/route.ts`。
面談由来（`interview_details`）に希望条件が**無い**候補者に限り、`advisor_type_diagnosis` を**面談時と同一形式**（`hasPreferences:true` + `preferences{desiredJobTypes,desiredPrefectures,desiredSalaryMin,desiredSalaryMax}`）で返す。理想額（`ideal_salary_*`）は seed に出さない。

- 消費側（mypage `src/app/api/site/preferences/route.ts` → `_lib/recommend.ts`）は `hasPreferences`/`preferences` のみ参照 → **無改修で診断由来を消費可能**（コード確認済み）。
- `source.origin`（`"interview"|"diagnosis"`）を追加（監査用の付加フィールド。消費側は source を分岐に使わないため後方互換）。mypage の `source` 型は `{interviewDate}` だが home ページで未使用（passthrough のみ）＝無害。

---

## 検証（実測）

| # | 項目 | 結果 |
|---|---|---|
| 1 | サンプル10件の構造化品質（表記ゆれ3実例の正規化） | ✅ 上記対比表。エリア/年収/職種すべて期待どおり・fail-safe空も正しい |
| 2 | 実質対象 5004272：preferences が hasPreferences:true・診断由来 | ✅ HTTP200 `hasPreferences:true` `source.origin:"diagnosis"` pref=[埼玉,東京,神奈川,千葉] min=450 max=600 |
| 3 | 面談ありは面談優先（切替なし） | ✅ 5004264（面談+診断両持ち）→ `source.origin:"interview"`・面談生値を返却（診断へ切替わらない） |
| 4 | E2E：診断会話→完了直後に自動保存→おすすめ反映 | ✅ テスト候補者5999995で発火点関数を実経路どおり呼出→行upsert→preferences即反映（許容下限400→min400・理想500-600別枠）。後始末で一時msg/session削除・実診断から行復元済み |
| 5 | 既存の診断体験が不変 | ✅ SKILL.md/アドバイザープロンプト無変更。発火点は保存済み応答を読むだけの別コール(fire-and-forget)で、Claude応答(`saved`)を一切改変しない |

---

## 他リポジトリで必要な変更（本タスクでは未実装・報告のみ）

- **なし**（bizstudio-portal 単独で完結）。mypage は無改修で診断由来 seed を消費できることをコードで確認済み。将来 `source.origin` を UI に出す場合のみ mypage 側の任意改修。

---

## 変更ファイル

| ファイル | 変更 |
|---|---|
| `prisma/schema.prisma` | `AdvisorTypeDiagnosis` モデル追加 |
| `prisma/migrations/20260704150000_t132_advisor_type_diagnosis/migration.sql` | テーブル作成（純追加） |
| `src/lib/advisor/diagnosis-extract.ts`（新規） | 検出/抽出/採用ルール/upsert/発火オーケストレータ |
| `src/lib/ai/gemini-client.ts` | usage も返す `generateWithGeminiDetailed` 追加（既存関数不変） |
| `src/lib/claude.ts` | Gemini 概算単価を `MODEL_PRICING_PER_MTOK` に追加 |
| `src/lib/advisor-usage.ts` | endpoint 種別に `diagnosis-extract` 追加 |
| `src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/route.ts` | 診断完了直後の fire-and-forget 発火 |
| `src/app/api/external/candidate-site/preferences/route.ts` | 面談なし時に診断由来を同形式でフォールバック供給 |
| `scripts/backfill-diagnosis-extraction-t132.ts`（新規） | 過去分バッチ（dry-run/execute・冪等） |

---

## テストデータの扱い

- E2E（検証4）で作成した一時 session/message は削除済み・5999995 の行は実診断から復元済み（残置なし）。
- バッチで保存した97行のうち 5999995/5999997/5999998（テスト候補者）は実診断由来の正当な行（残置可）。

---

## Git / デプロイ

- 実装コミット: **`eff1a08`** / token修正: **`60d705d`** / 本レポート: 後続コミット
- push前ゲート: `py scripts/wait_railway_idle.py`（両回とも idle 確認後 push）
- Railway 本番（bizstudio-portal）: 両デプロイとも **SUCCESS**（migration 適用・エンドポイント反映を本番コンテナ上の実HTTPで確認済み）
