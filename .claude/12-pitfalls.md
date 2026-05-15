# 12. 罠ポイント集

## 17. JST タイムゾーン

**罠**: portal の `timestamp without time zone` カラムは JST 値前提で運用されているが、ブラウザから `Date.toISOString()` でフルタイムスタンプ（時分秒含む UTC）を渡すと UTC 文字列に変換され、表示時に日付がずれる。特に `toISOString().slice(0,10)` で日付抽出すると JST 0:00-8:59 作成のレコードが**前日表示される9時間ずれバグ**が発生する。

### 対処パターン（既存実装の対比）

| モデル | 保存形式 | 表示時抽出 | 状態 |
|--|--|--|--|
| Task.dueDate | `new Date("YYYY-MM-DD").toISOString()` で T00:00:00Z 統一 | `toLocaleDateString("ja-JP")` または `split("T")[0]` | 正常 |
| Memo.date | `now.toISOString()`（フルタイムスタンプ送信） → T-032 で `toLocaleDateString('sv-SE')` に統一 | `toISOString().slice(0,10)` → T-032 で `toLocaleDateString('sv-SE')` に統一 | 修正済（commit 2ecc181, 2026/5/7） |
| tasks.created_at | DB 直接書き込み時は `new Date("...+09:00")` 形式 | - | スクリプトで要注意 |

### 採用パターン（推奨）

`toLocaleDateString('sv-SE')` を **保存・表示の両方で使う**。`'sv-SE'` ロケールは ISO 8601 形式（YYYY-MM-DD）をブラウザTZで出力するため、JST ブラウザでは正しい JST 日付になる。既存 UTC 保存データもブラウザ側で自動変換され、マイグレーション不要。

```typescript
// 保存時（新規作成）
const now = new Date();
body: JSON.stringify({
  date: now.toLocaleDateString('sv-SE'),  // "YYYY-MM-DD"
  // ...
});

// 表示時
value={memo.date ? new Date(memo.date).toLocaleDateString('sv-SE') : ""}
```

### 新機能で日付フィールド追加時のチェックリスト

1. 保存時: フロントから `"YYYY-MM-DD"` 形式 or `toLocaleDateString('sv-SE')` で送る
2. 表示時: `toLocaleDateString('sv-SE')` で日付抽出（`toISOString().slice(0,10)` は禁止）
3. JST 0:00-8:59 の作成シナリオで前日表示にならないか必ず動作確認
4. 既存パターン（Task の dueDate 処理）に揃えることで再発防止

### 関連ケース

- T-032 (2026/5/7): Memo.date の9時間ずれバグ修正、commit 2ecc181
- 室岡ほのかさん（5004405）2回目面談メモで該当（JST 5/7 06:15 作成 → 5/6 表示 → 修正後 5/7 表示）
- Phase C cleanup script 実装時にも JST タイムゾーン関連で発覚

### サブパターン: ソート順崩れ（interviewDate への時刻部分混入）

**罠**: `toISOString()` で送ったフルタイムスタンプが `DateTime` カラムに格納されると、同日レコードでも作成時刻分の差異が生じる。日付表示は正常に見えるが、**ソートキーとして使うと同日レコードの並び順が崩壊する**。

**症状**: 面談管理一覧で「日付降順 + 開始時刻昇順」の二次ソートを入れても、interviewDate 自体にフルタイムスタンプが入っているレコードが混在すると、一次ソートで同日にならず二次キーが効かない。日付表示は `toLocaleDateString` で正しく見えるため発見が遅れる。

**原因**: `InterviewHistoryTab.tsx` の「＋新規面談」ボタンが `now.toISOString()` で interviewDate を送信していた（例: `"2026-05-08T03:15:42.123Z"`）。他のコードパスは `"YYYY-MM-DD"` 形式で送信するため、DB 上で `2026-05-08T00:00:00.000Z` と `2026-05-08T03:15:42.123Z` が混在し、ソート順が崩れた。

**修正**: `now.toLocaleDateString("sv-SE")` に変更（commit ab108b9, 2026/5/8）

**教訓**: #17 の罠は「日付表示ずれ」だけではない。**ソートキーとして使われる DateTime カラムへの時刻部分混入は、表示上は気付けないソート順崩壊を引き起こす**。新規作成パスだけでなく、既存の全コードパスで interviewDate に `toISOString()` を使っていないか確認すること。

**関連ケース**: T-042 follow-up（2026/5/8）: 面談管理一覧のソート修正（API 側 orderBy は正常だったが、データ側の汚染で効かなかった）

### サーバー側の罠: Railway UTC 環境での `Date.getDay()` ずれ（追加事例）

上記まではブラウザ側（クライアント）で発生する TZ ずれの話。サーバー側でも別パターンの罠がある。

**症状**: サーバー（Railway 本番）で生成した `Date` から `getDay()` で曜日判定すると、JST の土曜が金曜扱いされる等のずれが発生。Windows/Mac のローカル開発環境（JST）では動いても、本番（Railway UTC）で壊れる。

**原因**: Railway 本番は UTC で動作。`Date.getDay()` はサーバーのローカル TZ 基準で曜日を返すため、UTC 環境では UTC 曜日を返す。JST 5/2 0:00 = UTC 5/1 15:00 → UTC では金曜（day=5）と判定され、土日除外を逃れる。

**対処パターン**: 入力 Date に +9h 補正してから `getUTCDay()` を使う。`src/lib/attendance/business-days.ts` の `isBusinessDay()` がリファレンス実装:

```typescript
import holiday_jp from "@holiday-jp/holiday_jp";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isBusinessDay(date: Date): boolean {
  const jstDate = new Date(date.getTime() + JST_OFFSET_MS);
  const day = jstDate.getUTCDay();  // JST 基準の曜日
  if (day === 0 || day === 6) return false;
  if (holiday_jp.isHoliday(jstDate)) return false;
  return true;
}
```

`@holiday-jp/holiday_jp` の `isHoliday()` も同様に補正済の `jstDate` を渡す（ライブラリは Date をローカル TZ 解釈するため、JST 補正後の Date を渡すのが安全）。

**サーバー側 TZ ずれ チェックリスト**（既存「新機能で日付フィールド追加時のチェックリスト」とは別物）:
- サーバーサイドで `Date.getDay()` / `getDate()` / `getMonth()` を **直接呼んでいる箇所は要確認**（特に営業日・祝日・曜日判定）
- `new Date(year, month-1, d)` もサーバーローカル TZ 依存（Railway では UTC 0:00 が生成される）
- 営業日・祝日・曜日判定は原則 `src/lib/attendance/business-days.ts` の `isBusinessDay()` 経由に統一する
- ローカル開発（JST）で動作確認 OK でも、本番（Railway UTC）で動かない可能性を必ず疑う
- `dayjs` の `cursor.day()` / `cursor.toDate().getDay()` も同じ罠あり、JST 補正必要

**関連ケース（サーバー側）**:
- T-033 緊急修正（commit `1a2b06a`, 2026/5/7）: Phase 4 で `isBusinessDay()` を導入したが初版が `date.getDay()` 直接呼び出しで、本番 Railway UTC 環境で 5/2 (土) が未打刻アラートに表示されるバグ発生。`+9h` 補正 + `getUTCDay()` で解決。

**詳細**: `03-portal-spec.md` の Memo 節参照

## 26. 面談モデル名は `InterviewRecord`（`Interview` ではない）

**罠**: schema.prisma の面談記録モデルは `InterviewRecord`。コード探索時に `Interview` で grep すると見つからない / 別モデルにヒットする。

**対処**:
- `prisma.interviewRecord.findFirst(...)` のように Prisma Client では `interviewRecord`（キャメルケース）
- DB テーブル名は `interview_records`（snake_case）
- 関連モデル: `InterviewAttachment` / `InterviewMemo` / `InterviewDetail` / `InterviewRating`（こちらは Interview プレフィックス）
- コンポーネント名は `InterviewForm.tsx` / `InterviewHistoryTab` 等（コンポーネント命名は別系統、変更不要）

**関連ケース**: T-029 Phase D-1 調査時にドキュメント上 `Interview` 表記としていたが、実装は `InterviewRecord`。Phase D-2 完了時にナレッジ修正。

## 27. ファイルストレージ二系統（CandidateFile = Drive、InterviewAttachment = Supabase）

**罠**: portal にはファイルストレージが 2 系統あり、用途・ダウンロード関数が完全に違う。混同するとコードが動かない。

| | CandidateFile | InterviewAttachment |
|--|--|--|
| ストレージ | Google Drive | Supabase Storage |
| ID フィールド | `driveFileId` | `filePath` |
| ダウンロード | `downloadFileFromDrive(driveFileId)` | Supabase SDK |

**対処**:
- portal → candidate-intake の連携で送るファイルがどちらの系統か必ず確認
- T-029 Phase D-2: CandidateFile 系統（Google Drive）
- 既存 analyze-with-intake: InterviewAttachment 系統（Supabase）

**詳細**: `02-data-sources.md`「ファイルストレージの二系統」参照

## 28. candidate-intake `extract_resume` は multipart/form-data 必須

**罠**: candidate-intake の `/api/intake/extract_resume` は **multipart/form-data 形式**で受け取る。
他の API（`/generate_form`、`/create_form_v2`、既存の `/api/portal/analyze-interview`）は JSON。
JSON で送ると 400 エラー or 想定外の動作。

**対処**:
- portal API ラッパーで FormData + Blob を組み立てて送信
- `pdf` キーに Blob (application/pdf)、`interviewLog` キーに Blob (text/plain)、`candidateId` キーに string を append
- 既存 analyze-with-intake の base64 JSON パターンを流用しないこと（別系統）

**関連ケース**: T-029 Phase D-2 portal API extract-resume/route.ts 実装時に判明

## 29. 業界混在候補者で AI Google フォームが全社同じテンプレ展開される

**罠**: T-029 Phase D-2 で実装した AI Google フォーム生成は、候補者単位で 1 つの achievementCategory だけ受け取る仕様だったため、業界混在候補者（西さん 5004292 のグランドスタッフ + 事務 等）で全社に同じ業務内容テンプレが展開されてミスマッチ発生。

**結果**:
- 全社で同じ duties_choices（11 項目）/ kpi_questions が出る
- 1 業界キャリアの候補者では問題ないが、複数業界経験ある候補者で実態と乖離

**対処（T-035 で実装済み）**:
- portal モーダルで会社別カテゴリ選択（会社ごとにドロップダウン、デフォルトを各社初期値に適用、変更したい社のみ変える）
- portal API proxy が `companyCategoryMap` を candidate-intake へ転送
- candidate-intake が `companyCategoryMap` で各社のテンプレを per-company 解決
- mindset_section は defaultCategory（achievementCategory）流用、"other" 自由記述はグローバル 1 つを共有

**関連コミット**:
- candidate-intake staging: 3a0a5b4
- portal master: fdb20a9

## 30. supportSubStatus の自動更新で手動値が消える

**罠**: `Candidate.supportSubStatus` は `recalculateSubStatusIfAuto()` で自動再計算される。手動で上書きした値も、次の自動再計算トリガー（ブックマーク追加・エントリー更新等）で上書きされうる。

**対処**: `supportSubStatusManual` フラグが true のレコードは自動再計算をスキップするガード実装が存在する。

### 運用方針（T-031 で確定、2026/5/8）

**`supportSubStatusManual` は使わない**。
自動再計算ロジック（`recalculateSubStatusIfAuto()`）に全面的に任せる運用とする。

理由:
- 手動上書きを行わない限り、本罠ポイントで懸念される「手動値が自動再計算で消える」シナリオは原理的に起こらない
- T-031（保護実装）は仕様判断（手動上書きしない方針）でクローズ済み

実装上の注意:
- 新規実装で `supportSubStatusManual = true` を設定する処理を追加しないこと
- 既存の Manual フラグ参照箇所は残置（過去データの整合性維持のため）
- CA 向け UI でも「手動上書き」操作は提供しない方針

## 31. D&D ハンドラと `<input multiple>` 属性のセット漏れ

**罠**: 新規 D&D UI 実装時、以下のセット漏れが頻発する。
- `onDrop` ハンドラで `e.dataTransfer.files[0]` のみ拾い、複数ファイル D&D で最初の1件しか処理されない
- `<input type="file">` に `multiple` 属性が付いておらず、ファイル選択ダイアログでも複数選択不可
- `onChange` ハンドラも `e.target.files?.[0]` のみ拾い、複数選択しても1件しか処理されない

3点はセットで発生しがち。1つだけ修正しても他2つが残ると複数ファイル対応にならない。

**結果**:
- 業務効率低下（CA が1ファイルずつ D&D する手間）
- 「複数ファイル添付できない」というバグ報告が表面化するまで気付かれない（単一ファイルでは正常動作するため）

**対処（推奨実装パターン）**:

1. `<input type="file" multiple>` 属性を必ず付ける
2. `onDrop` で `Array.from(e.dataTransfer.files)` してループ処理
3. `onChange` で `Array.from(e.target.files ?? [])` してループ処理
4. アップロード自体は API 単一ファイル前提でよい、フロント側で個別 POST を逐次ループ（並列は API 負荷リスク・順序保証なしのため非推奨、`for...of` + `await` で逐次実行）

```typescript
// 推奨パターン
const handleUploadMultiple = async (files: File[]) => {
  for (const file of files) {
    await handleUpload(file);
  }
};

const onDrop = (e: React.DragEvent) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) handleUploadMultiple(files);
};

const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  if (files.length > 0) handleUploadMultiple(files);
};

// JSX
<input type="file" multiple onChange={onChange} />
```

**該当しうる画面**:
- `bizstudio-portal`: `InterviewForm.tsx` の添付タブ（T-041 で修正済み）、`DocumentsTab.tsx` の面談サブタブ・ブックマークタブ
- `kyuujin-pdf-tool`: フロントエンドのファイルアップロード画面

新規 D&D UI 実装時、または既存 D&D UI を改修するときは必ずこのパターンに揃えること。

**関連ケース**:
- T-041（2026/5/8）: InterviewForm 添付タブで3点同時に該当、master commit cde6530 で全て修正

## 32. AI フラグ定数の二重 SSoT（candidate-intake flags.ts ↔ portal candidate-flags.ts）

**罠**: AI 解析で使うフラグ enum は candidate-intake `src/constants/flags.ts` と portal `src/constants/candidate-flags.ts` の 2 ファイルに**同一内容が独立管理**されている。片方だけ更新すると AI 出力と UI 選択肢が乖離し、A-1 パターン（AI値が UI に出ない）が発生する。

**さらに FLAG_LIST_TSV も同期必須**: `FLAG_DEFINITIONS` の enum 配列とは別に、`FLAG_LIST_TSV` という TSV 文字列が Gemini プロンプトに直接渡される（`loadSpec.ts` L282）。FLAG_DEFINITIONS だけ更新して FLAG_LIST_TSV を忘れると、Gemini が古い TSV を参照して旧値を出力する。

**対処**:
- フラグ選択肢変更時は必ず 4 箇所を同時更新: (1) candidate-intake FLAG_DEFINITIONS (2) candidate-intake FLAG_LIST_TSV (3) portal FLAG_DEFINITIONS (4) portal FLAG_LIST_TSV
- 詳細手順は `06-other-repos.md`「SSoT 同期警告」参照

**関連ケース**: T-051 Step 2（2026/5/10）

## 33. interview-analyzer-mapping.ts のフィールド名マッピングに注意

**罠**: AI 解析結果の日本語キー（例: `LINE設定フラグ`）が DB のどのカラムに書き込まれるかは `src/lib/interview-analyzer-mapping.ts` で定義される。UI のドロップダウンラベルと AI のマッピング先が異なるケースがある。

**具体例**:
- `LINE設定フラグ` → `lineSetupFlag`（contactMethod ではない）
- `求人送付フラグ` → `jobReferralFlag`

UI の「⑤連絡手段」ドロップダウンは `contactMethod` カラムに保存されるが、AI は `lineSetupFlag` に書き込む。つまり AI は contactMethod に直接書き込まない。

**対処**: フラグ変更時は mapping ファイルでカラム名を確認してから AI 側の定数を変更すること。

**関連ケース**: T-051 Step 2 調査で判明（2026/5/10）

## 34. 採番ロジックの加算値が暗黙のドメイン前提になっている

**罠**: 採番関数の `nextNumber = maxNum + N` の `N` が暗黙の値(1, 10, 100 等)で実装されており、コード上は単純な加算でも意図と異なる挙動を生む。コードレビューで「単純な加算」として読み飛ばされやすい。

**結果**:
- T-050(2026/5/12)では `+ 100` で実装されており、新規登録のたびに番号が 100 単位で飛ぶ問題が発生
- 22 件のデータが直近 5 日で生成され、kyuujinPDF / マイページの `job_seeker_id` として外部流通
- 振り直しは外部連携破壊リスク大、欠番として残置せざるを得なかった

**対処**:
- 採番関数を実装する時、`+ N` の N が**意図通りか**を必ずコメントで明示
  - 例: `nextNumber = maxNum + 1;  // 連番採番、+1 が正(過去 +100 バグあり、T-050)`
- 採番ロジックは**単一箇所に閉じる**(複数箇所での新規生成を作らない、grep で確認)
- 衝突回避ループとの整合性を確認する(+1 で進むループの直前で `maxNum + N` の N が 1 でないと整合が崩れる)
- 初期値(DB に 1 件もない時の値)と通常採番値の整合性も確認(例: 通常 `+1` なら初期値は `5000001`、`+100` なら `5000100`)
- 採番ロジックを修正した時、**過去に流通済みの番号を振り直さない判断**を最初に固める(外部連携先がある場合)

**関連バグ**: `08-bug-patterns.md` カテゴリH 1 件目

## SKILL.md の更新は2箇所への反映が必要

**罠**: `job-matching-advisor` スキルの SKILL.md を更新する場合、以下の両方を更新しないと一部の機能が古いまま残る。

1. **Claude.ai プロジェクトの SKILL.md**（Claude.ai での個人開発会話に影響）
2. **portal リポジトリの `src/skills/job-matching-advisor/SKILL.md`**（portal AIアドバイザー画面に影響）

片方だけ更新すると、Claude.ai 上では新版で動くが、portal AIアドバイザー（チャット + 全件分析）は古いままになる。

**更新時のチェックリスト**:
- [ ] `C:\claude\skill\SKILL.md` を編集
- [ ] `C:\claude\skill\references\middle-career.md` を編集（変更がある場合）
- [ ] Claude.ai プロジェクト設定で「置き換え」実行
- [ ] portal リポジトリの `src/skills/job-matching-advisor/SKILL.md` にも反映（コピー or 直接編集）
- [ ] portal リポジトリの `src/skills/job-matching-advisor/references/middle-career.md` にも反映
- [ ] portal で commit → master push → staging merge → push

**反映確認**:
- portal は staging push でしか本番デプロイされない（master push 単独では反映されない）
- ヘルパー関数 `src/lib/load-job-matching-skill.ts` がモジュールロード時にキャッシュするため、Railway 再デプロイ後に新内容が反映される

**関連**: T-056（2026/5/14）で portal への SKILL.md 反映の仕組みを構築、`06-other-repos.md` の job-matching-skill セクション参照

## SKILL.md 更新後は AIアドバイザーのチャット履歴クリアが必要

**罠**: portal の AIアドバイザーは直近20件の過去メッセージを `pastMessages` として毎回 LLM に送信する。SKILL.md を更新・デプロイしても、過去の応答が履歴に残っていると LLM が few-shot learning 効果で旧版の応答パターンを模倣し、新しい SKILL.md の内容が反映されないように見える（**Pattern G: 過去チャット履歴汚染**）。

**対処**: SKILL.md 更新後、内容が変わった候補者のアドバイザーセッションは「チャットクリア」で履歴をリセットしてから検証すること。

**確認方法**: 履歴クリア後に新 SKILL.md 固有のキーワード（例: 統計数値）を含む質問をし、新版の数値が返ることを確認する。

**関連**: T-056（2026/5/14）で原因特定。`06-other-repos.md` の job-matching-skill 反映フロー参照

## 35. kyuujinPDF と portal の JobEntry は一方向コピーで同期しない

**罠**: portal の `JobEntry` レコードは、CA がエントリー操作した時点で kyuujinPDF の Job データをコピーして作られる。コピー後は **再同期されない**。kyuujinPDF 側で `Job.job_db` や `Job.company_name` や `Job.job_type` を修正しても portal の対応カラムは古いまま残る。

**結果**:
- kyuujinPDF の DB マイグレーションだけで Job を修正しても、エントリー管理画面では古い値が表示され続ける
- 「kyuujinPDF を直せば portal も直る」と誤認しがち（実際は両方の DB を更新する必要がある）
- 逆に CA がエントリー操作していない求人は portal の JobEntry に存在しないため、portal 側マイグレーション対象が 0 件になることもある（正常）

**対処**:
- kyuujinPDF Job の修正と portal JobEntry の修正は両方マイグレーションする
- portal 側 JobEntry の `externalJobId` が kyuujinPDF の `Job.id` を参照しているので、これをキーにして両者を同期して更新
- portal 側マイグレーション結果が 0 件でも異常ではない（該当求人を CA がエントリー化していなければ正常）

**関連ケース**:
- T-028: kyuujinPDF Job 7 件を修正したが、対応する portal JobEntry は 0 件だった
- 修正コミット: portal 9b22b94
