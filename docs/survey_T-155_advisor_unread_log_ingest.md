# T-155 Phase 1 調査レポート — AIアドバイザーの未読ログ取り込み

調査日: 2026-08-02 / 対象: bizstudio-portal 単独 / master worktree（HEAD: dad3dcf）
**実施範囲: 調査のみ。コード変更・本番DBへの書き込みは一切行っていない（SELECT のみ）。**

---

## ★最初に読むこと — 本プロンプトの前提と異なる事実（3件）

### (1) AIアドバイザーは**既に面談ログ（MEETING txt）を読んでいる**。ただし「不安定に」

チャットのコンテキストを組み立てる `getCandidateContext`（`src/lib/advisor-context.ts` L113-153）は、
**ORIGINAL / BS_DOCUMENT / MEETING の PDF・txt を `createdAt desc` で最大4件**読み込んで本文をコンテキストに含めている。txt は 8,000 字で切り詰め（L6 `MEETING_TEXT_MAX_CHARS`）。

→ 「CAがチャットにログ全文を貼っている」のは機能が無いからではなく、**この経路が信用できないから**と考えられる。信用できない理由は構造的に4つ:

| # | 理由 | 根拠 |
|--|--|--|
| a | **最新4件の枠を他書類と奪い合う**。履歴書PDF等が後からアップされると面談ログが枠から押し出される | L113-122（3カテゴリ混合で take: 4） |
| b | **8,000字で切り詰め**。実測の面談ログ中央値は約13,000字（後述 D-5）＝**半分弱しか読まれない** | L133-135 |
| c | **コンテキスト全体が20,000字で切り詰め**。主要書類はコンテキスト中盤にあり、後半が切られる | messages route L101 `MAX_CONTEXT_CHARS = 20000`・L263-265 |
| d | **セッション単位の30分キャッシュ**。ログを添付した直後でも、既存セッションでは最大30分古いコンテキストで会話が続く | messages route L100 `CACHE_TTL = 30*60*1000`・L240-241 |

**含意**: T-155 の本質は「読む機能の新設」ではなく、**「確実に・全量を・即時に反映される読み込み経路と、その結果の永続化」**である。要約を永続化して basic info 直後に差し込めば a〜d をすべて回避できる。

### (2) 「読み込み済みの印」に流用できる既存カラムは**無い**（新設が必要）

`candidate_files` の候補カラムはすべて別用途で稼働中:
- `extractedText` / `extractedAt` → BOOKMARK 求人票のテキスト抽出（`bookmarks/extract-text` / job-platform webhook / T-132 diagnosis-extract が書く）
- `aiMatchRating` / `aiAnalysisComment` / `aiAnalyzedAt` → 全件分析（BOOKMARK）の評価結果
- `lastExportedAt` → 出力管理

MEETING txt に流用すると既存パイプラインと意味が衝突する。**新カラム追加が必要**（項目4で設計）。

### (3) タイプ診断ボタンは独立経路ではなく「チャットへの定型文投稿」

`AdvisorFloatingPanel.tsx` L456-492 の `handleTypeDiagnosis` は固定文言を **messages API にそのまま投げている**。情報収集経路はチャット自由入力と完全に同一。「ボタン＝別経路」ではない（後述 項目1）。T-155 の「未読ログを読み込む」ボタンをこの方式（チャットに定型文投稿）で作ると 20k 字制限に噛まれるため、**専用エンドポイントにすべき**。

---

## 1. AIアドバイザーの情報収集経路

### エンドポイント一覧（`AdvisorEndpoint` union / `src/lib/advisor-usage.ts` L20-27 起点）

| endpoint | 実体 | AI | 情報収集 |
|--|--|--|--|
| `advisor-chat` | `advisor/sessions/[sessionId]/messages/route.ts` | Anthropic Sonnet | **context（下記）+ 直近20メッセージ + 添付解析** |
| `greeting` | `advisor/greeting/route.ts` | Anthropic | context + **MEETING ファイル最新5件を毎回 Drive DL・解析**（L141-160）+ チャット履歴 |
| `analyze-batch` | `bookmarks/analyze-batch/route.ts` | Anthropic **Opus**（`CLAUDE_MODEL_ANALYSIS`） | context + BOOKMARK の `extractedText` 全件 |
| `diagnosis-extract` | `src/lib/advisor/diagnosis-extract.ts` | Gemini | 診断応答本文のみ（後読み構造化） |
| `interview-task-detect` | `src/lib/interview/detect-suggested-tasks.ts`（T-151） | Anthropic Sonnet | 面談ログ txt のみ |
| `daily-report-*` | 日報系 | — | 対象外 |

### チャット自由入力 vs ボタンの違い

- **自由入力**と**タイプ診断**: 完全に同一（診断はチャットへの定型文投稿。★(3)）
- **全件分析**: `getCandidateContext` + BOOKMARK 全件の extractedText。**Opus**を使う別呼び出し
- **挨拶文生成**: context + **MEETING 最新5件の本文**（greeting だけがログを「多め」に読む）+ 履歴

### context（`getCandidateContext`）が読んでいるもの一覧

| セクション | ソース | 制限 |
|--|--|--|
| 基本情報 | `Candidate`（氏名・番号・メール・生年月日・性別・担当CA・登録日） | — |
| 転職軸ワークシート / PREP / AI自己分析 / 職務経歴書解析テキスト | `GuideEntry(guideType=INTERVIEW).data` の JSON キー | — |
| CAメモ | `CandidateNote` 全件 | — |
| ファイル一覧 | `CandidateFile` 全件（**ファイル名のみ**） | — |
| **主要書類の内容** | ORIGINAL/BS_DOCUMENT/MEETING の PDF・txt | **最新4件・txt 8,000字**。PDF は毎回 `parsePdfWithAI`（**Gemini OCR**・caller="advisor-context"） |
| 応募履歴 | `JobEntry` | 直近20件 |
| ブックマーク求人票 | BOOKMARK の extractedText | 最新5件 × 1,500字 |

### 会話履歴の保存と利用

- 保存: `AdvisorChatMessage`（role/content。T-150 の suggestedTasks 列も同居）
- 利用: 毎ターン全件取得 → **直近20件**（`MAX_PAST_MESSAGES`）を messages 配列として送信。最終 user メッセージは `<ca_input>` / `<attachment>` 構造に差し替え（T-150）
- 添付は解析結果が `fullContent` に連結されて**ユーザーメッセージとして DB に残る**（＝過去ターンとして以後も送られ続ける。CAがログ全文を貼る現運用が高コストな理由でもある）

### T-152 との関係（混同注意）

`analyze-with-intake`（面談登録の自動入力）は T-152 で「interviewId 紐付き txt 優先」に変わったが、**advisor-context / greeting のファイル選択は別実装のままで、T-152 の影響を受けていない**（両方とも `createdAt desc` の素朴な選択）。

---

## 2. プロンプトの組み立て方

`messages/route.ts` L279-289:

```ts
const systemBlocks = [
  { type: "text", text: ADVISOR_PERSONA_PROMPT + getJobMatchingSkillFull() + TASK_DETECTION_PROMPT,
    cache_control: { type: "ephemeral" } },        // 固定（候補者横断でキャッシュ）
  { type: "text", text: CANDIDATE_DATA_HEADER + context },  // 可変（キャッシュなし）
];
```

- **固定部分**: ペルソナ + job-matching スキル全文 + T-150 検出指示。byte 安定・`cache_control` 付き（罠#39 準拠）
- **可変部分**: `CANDIDATE_DATA_HEADER + context`。**ここに求職者情報がプレーンな Markdown 風テキスト（`## 見出し` 区切り）で埋め込まれる**
- prompt キャッシュのルール: **可変ブロックには cache_control を付けない**。要約（AI生成＝非決定的テキスト）をここに足してもキャッシュ影響はない
- ★可変ブロックは 20,000 字で切り詰め（L263-265）。**切られるのは末尾**なので、確実に届けたい情報は context の**前方**に置く必要がある

---

## 3. 要約の保存先候補

### 既存の「求職者の要約」に類するもの

| 候補 | 実体 | 評価 |
|--|--|--|
| `GuideEntry(INTERVIEW).data` の JSON キー | `ai_generated_axis` / `parsed_resume` 等が既に context に流れている | **非推奨**。GuideEntry は面談ガイド（token 付き・`/api/guides/[token]` で**外部＝求職者側に露出する**構造）。CA向けAI要約を混ぜると漏洩リスク。書き手も guides API で用途が違う |
| `AdvisorChatSession.contextCache` | セッション単位・30分TTL の一時キャッシュ | **不可**。永続ストアではない |
| `Candidate` の既存 Text 列（`supportEndComment` / `nextContactNote`） | 別用途 | 不可 |

### 推奨: **`Candidate` に nullable カラム2本を新設**

```prisma
// T-155: 面談ログ取り込みの累積ダイジェスト（AIアドバイザーの context 専用）
advisorLogDigest          String?   @map("advisor_log_digest") @db.Text
advisorLogDigestUpdatedAt DateTime? @map("advisor_log_digest_updated_at")
```

- 新規テーブル比較: 1求職者1ダイジェストの単純な形なのでテーブルは過剰。履歴が必要になったら後から昇格できる
- nullable 純粋追加＝デプロイルール上 master 直 push 可の条件を満たす（機能全体は staging 経由にすべきだが）
- `getCandidateContext` に「## 面談内容の要約（取り込み済みログより）」セクションとして**基本情報の直後（前方）**に差し込む → 20k 切り詰めの影響を受けない

### 追記 vs 作り直し → **「累積ダイジェスト1本を更新」を推奨**

- 追記方式: 読むたびに全文が伸び、20k 制限と将来の入力費用を圧迫する。❌
- 毎回全ログから作り直し: 読み込み済みの旧ログを再度AIに食わせる＝費用が毎回線形増。❌
- **推奨**: 取り込み実行時に「既存ダイジェスト + 今回の未読ログ全文」を入力し、**統合された新ダイジェスト（上限目安 3,000〜4,000字）を出力させて上書き**。費用は今回分のみ、サイズは一定に保たれる。面談は最大4回（実測）なので情報の圧縮劣化も限定的

---

## 4. 読み込み済みフラグの設計

- 流用可能カラム: **無し**（★(2)）
- 推奨: `candidate_files` に **`advisorIngestedAt DateTime? @map("advisor_ingested_at")`** を1本追加
  - **タイムスタンプが必要**（「いつ読んだか」）。NULL=未読なので boolean を別に持つ必要はない。再読み込み判断・障害調査・「読み込み済み 8/1 14:30」の UI 表示がこれ1本で賄える
  - 部分 index `WHERE advisor_ingested_at IS NULL`（category='MEETING'）を張れば未読カウントが軽い
- **T-152 `interviewId` との関係**: 独立でよい。取り込み対象は「`category='MEETING'` かつ txt かつ `archivedAt IS NULL` かつ `advisorIngestedAt IS NULL`」の**全件**（`interview_id` の有無は問わない）。要件3「まだ読み込んでいないログを全件まとめて」と一致し、添付タブ経由（interview_id=NULL）のログも漏らさない

---

## 5. 現状データの実測（2026-08-02 本番・SELECT のみ）

| # | 計測内容 | 実測値 |
|--|--|--|
| D-1 | MEETING・非archive の txt 総数 | **377** |
| D-2 | 保有求職者数 | **288** |
| D-3 | txt 2件以上の求職者数 | **72** |
| D-4 | 1人あたり件数分布（1/2/3/4/5+件） | **216 / 59 / 9 / 4 / 0**（最大 **4件**） |
| D-5 | 文字数（実サンプル25件・T-151 調査時に Drive 実体を取得済み） | 最小 372 / 中央値 **13,278** / p75 16,832 / 最大 19,366 字 |
| D-5' | file_size からの全数換算（377件、UTF-8 日本語 ≒2.8 byte/字） | 平均 27,785B≒**9,900字** / 中央値 30,330B≒**10,800字** / 最大 88,555B≒**31,600字** |
| — | 最大保持者（4件）の合計サイズ | 104,087B ≒ **37,000字** |

D-5 の実サンプルは `docs/survey_T-151_interview_task_phase1.md` 項目2で取得したもの（同一母集団・同日精査）。全数の byte 換算と整合している。

---

## 6. AI費用の見積もり

- モデル: `CLAUDE_MODEL_DEFAULT` = **claude-sonnet-4-6**（`src/lib/claude.ts` L9。input $3/MTok・output $15/MTok）
- 前提: 日本語 ≒1 token/字（保守的）。出力＝統合ダイジェスト ~4,000字＝~4,000 tok

| ケース | 入力 | 概算費用/回 |
|--|--|--|
| 典型（未読1件・中央値 10,800字 + 既存ダイジェスト 4,000字 + 指示文） | ~16k tok | 入力 $0.048 + 出力 $0.060 = **$0.11** |
| 未読2件まとめて | ~27k tok | **$0.14** |
| **最悪ケース（最大保持者・4件 37,000字を全件未読で一括）** | ~42k tok | 入力 $0.13 + 出力 $0.06 = **$0.19** |

- 全377件を一斉に取り込んでも入力 ~3.7M tok ≒ **$11 + 出力** 程度（バックフィルする場合の参考）
- **Gemini は消費しない**（Anthropic のみ。txt は OCR 不要で `parseTextFile` 相当の生読みで済む）
- ★副次効果: ダイジェストが context に入れば、`advisor-context` の「主要書類4件」から MEETING を除外（または優先度を下げる）余地が生まれ、**セッションごとに繰り返し発生している Drive DL + Gemini OCR（caller="advisor-context"）の削減**につながる（Phase 2 で判断）

---

## 7. UI の置き場所

- コンポーネント: `src/components/candidates/AdvisorFloatingPanel.tsx`（唯一の生きたチャットUI。`AdvisorTab.tsx` は dead code）
- ボタン列: **L688-730 付近**。「🔍 タイプ診断」（L688-701）→ `ml-auto` グループに「📊 全件分析」（L714-721）＋「未評価/破損のみ」トグル。ここに同じスタイル（`bg-blue-50 hover:bg-blue-100 border-blue-200 ...`）で「📥 未読ログを読み込む」を並べるのが自然
- **未読件数の表示は可能**。`GET /api/candidates/{id}/files?category=MEETING` は既存で、T-155 でカラムを追加すれば `advisorIngestedAt` も返せる（T-152 で `interviewId` を select に足した先例あり: `files/route.ts`）。パネルを開いた時に fetch して「📥 未読ログを読み込む（2件）」と出せる。0件時は disabled
- 実行中表示は `isAnalyzing` / `analysisProgress` と同じパターンを流用できる

---

## 8. 想定される衝突・リスク

| # | 項目 | 内容 |
|--|--|--|
| 1 | **T-151/T-152 とのファイル重複** | `AdvisorFloatingPanel.tsx`（T-151 でカード追加済み・今回はボタン列で別セクション）/ `files/route.ts` の select（T-152 で interviewId 追加済み・1行追加のみ）/ `candidate_files` スキーマ（T-152 の interviewId と共存、単純追加）。**messages route は触らない設計にすれば T-150/151 の稼働部と非衝突** |
| 2 | **contextCache の無効化が必須** | 取り込み完了時に該当求職者の全セッションの `contextCache` を破棄（`advisorChatSession.updateMany({ where: { candidateId }, data: { contextCache: null, contextCachedAt: null } })`）しないと、**要件6「以降会話するだけで最新」が最大30分満たされない**。実装必須項目 |
| 3 | **20k 字制限との位置関係** | ダイジェストは context 前方（基本情報直後）に差し込む。末尾に足すと切り詰めで消える |
| 4 | prompt キャッシュ（罠#39） | ダイジェストは可変ブロック側なので影響なし。**固定ブロック側に取り込み関連の指示を足す場合のみ** byte 安定に注意 |
| 5 | greeting の重複読み込み | greeting は今後も MEETING 5件を毎回読む（独自実装）。T-155 後は二重読みになるが、壊れはしない。ダイジェスト参照への置き換えは別タスク候補 |
| 6 | 巨大 txt | 最大 88KB（≒31,600字）が実在。取り込み入力にも上限（例 40,000字/回・超過分は分割 or 切り詰め）を設けること（T-151 の `MAX_LOG_CHARS = 40_000` と同じ発想） |
| 7 | 取り込みとフラグ更新の原子性 | AI呼び出し成功 → ダイジェスト保存 → `advisorIngestedAt` 更新 → contextCache 破棄 の順にし、**AI失敗時はフラグを立てない**（fail した分は未読のまま残り再実行できる） |
| 8 | 音声ファイル | 添付欄は .mp3/.m4a も受けるが MEETING の実体は txt/pdf のみ（実測）。txt 限定で問題ない |

---

## 実装方針の推奨案（まとめ）

| 論点 | 推奨 |
|--|--|
| 読み込みの実行形態 | **専用エンドポイント** `POST /api/candidates/[candidateId]/advisor/ingest-logs`（チャット定型文方式は 20k 制限・履歴汚染で不適 ★(3)） |
| 対象選定 | MEETING・txt・非archive・`advisorIngestedAt IS NULL` の全件（interview_id 不問） |
| 要約方式 | 既存ダイジェスト + 未読ログ全文 → **統合ダイジェスト1本に上書き**（3,000〜4,000字上限） |
| 保存先 | `Candidate.advisorLogDigest` / `advisorLogDigestUpdatedAt`（nullable 新設） |
| 既読フラグ | `CandidateFile.advisorIngestedAt`（nullable 新設・NULL=未読） |
| context への反映 | `getCandidateContext` の基本情報直後に新セクション + **取り込み完了時に contextCache 全破棄** |
| UI | ボタン列に「📥 未読ログを読み込む（N件）」。0件時 disabled |
| AI | Anthropic Sonnet（`CLAUDE_MODEL_DEFAULT` 定数参照）・`recordAdvisorUsage` に endpoint `"advisor-log-ingest"` を追加（union に1行） |
| 費用 | 典型 $0.11/回・最悪 $0.19/回。Gemini 消費ゼロ |

### 実装フェーズ分割案

| Phase | 内容 | 備考 |
|--|--|--|
| 2-1 | スキーマ: `Candidate` 2列 + `CandidateFile` 1列（すべて nullable） | 単独で master 直 push 可相当。T-151/152 と同じ手書きマイグレーション様式 |
| 2-2 | 取り込みエンドポイント + ダイジェスト生成 + フラグ更新 + contextCache 破棄 | fail-open ではなく**fail-closed**（失敗時は未読のまま・エラーを UI に返す）。usage 記録追加 |
| 2-3 | `getCandidateContext` にダイジェストセクション追加（前方配置） | 20k 制限内の配置確認 |
| 2-4 | UI: ボタン + 未読件数 + 読み込み済み表示 | `files` GET に `advisorIngestedAt` を追加 |
| 2-5 | staging 検証（大野テスト 5999999）→ master | ダイジェスト品質・cache 破棄の即時性・T-150/151 回帰 |

---

## 付記: 使用した読み取り専用スクリプト

本番 DB 計測（`railway ssh --service bizstudio-portal` 経由・SELECT のみ）:

```sql
WITH txt AS (
  SELECT candidate_id, id, file_size, created_at FROM candidate_files
  WHERE category='MEETING' AND archived_at IS NULL
    AND (lower(file_name) LIKE '%.txt' OR mime_type LIKE 'text/%')
), per AS (SELECT candidate_id, count(*) n FROM txt GROUP BY 1)
SELECT 'D-1' , count(*) FROM txt
UNION ALL SELECT 'D-2', count(*) FROM per
UNION ALL SELECT 'D-3', count(*) FROM per WHERE n>=2
UNION ALL SELECT 'D-4 dist', count(*) FILTER (WHERE n=1) || '/' || count(*) FILTER (WHERE n=2)
  || '/' || count(*) FILTER (WHERE n=3) || '/' || count(*) FILTER (WHERE n=4) || '/' || count(*) FILTER (WHERE n>=5) FROM per
UNION ALL SELECT 'D-4 max', max(n) FROM per
UNION ALL SELECT 'max holder total bytes',
  (SELECT sum(t.file_size) FROM txt t WHERE t.candidate_id=(SELECT candidate_id FROM per ORDER BY n DESC LIMIT 1))
UNION ALL SELECT 'size avg/med/max',
  round(avg(file_size)) || '/' || percentile_disc(0.5) WITHIN GROUP (ORDER BY file_size) || '/' || max(file_size) FROM txt;
```

D-5 の文字数実測は `docs/survey_T-151_interview_task_phase1.md` 調査時の Drive 実体サンプル25件（`drive.readonly` スコープ・`files.get` のみ）を引用。
