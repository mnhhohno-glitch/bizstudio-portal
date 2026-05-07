# 02. データソース source of truth 一覧

「このデータの正解はどこにあるか」を1表で整理。データ整合性に関する議論で必ず参照する。

## 求職者の基本情報

| データ | source of truth | 備考 |
|--|--|--|
| 氏名・生年月日・連絡先 | bizstudio-portal `Candidate` モデル | マイナビからの初回取り込みも portal に保存 |
| candidateNumber | portal `Candidate.candidateNumber` | 重複しない一意ID（5桁数字）|
| 性別・住所・最終学歴 | portal `Candidate` | AI解析で自動入力後、CA が確認 |
| 担当CA | portal `Candidate.assignedUser` | |
| 支援ステータス（ACTIVE/INACTIVE等）| portal `Candidate.supportStatus` | |
| 支援サブステータス（BM/求人紹介等）| portal `Candidate.supportSubStatus` | 自動再計算ロジック有り（recalculateSubStatusIfAuto）|

## 面談関連

| データ | source of truth | 備考 |
|--|--|--|
| 面談ログ・添付ファイル | portal `InterviewRecord`, `InterviewAttachment` (Supabase Storage) | |
| 面談 AI 解析結果 | candidate-intake で生成 → portal の `InterviewRecord` フィールドに保存 | 解析実体は intake 側、portal 側のYAMLは無効 |
| 職務経歴 | portal `WorkHistory` | |
| 退職理由（大・中・小）| portal `InterviewRecord.resignReason*` | 3段連動セレクタ、enum 定義あり |
| Google フォーム formId / editUrl / viewUrl | portal `InterviewRecord`（isLatest=true）の `googleForm*` カラム | T-029 Phase D-2 で追加、isLatest=true がない場合は永続化スキップ（フロント保持） |

## 求人・ブックマーク関連

| データ | source of truth | 備考 |
|--|--|--|
| ブックマーク PDF（保管）| portal `CandidateFile` (category=BOOKMARK) | Google Drive にも保管 |
| 求人マスター（マイページ送信後）| **kyuujinPDF `Job` テーブル** | portal は externalJobId 経由で参照 |
| 求人の company_name | **kyuujinPDF `Job.company_name`** | portal でマッチング時は正規化必須 |
| 求人の `Job.work_location` | **kyuujinPDF（PDF から Gemini Vision で抽出）** | media 別に抽出経路差分あり、`13-data-source-paths.md` 参照 |
| **Circus 案件の詳細住所（番地レベル）** | **Circus URL の `__NEXT_DATA__.addressDetail`** | PDF からは抽出困難。未活用、T-028 候補。`13-data-source-paths.md` 参照 |
| AI 評価ランク（A/B/C/D）| portal `CandidateFile.aiMatchRating` | analyze-batch で保存 |
| AI アドバイザーコメント | portal の `advisorChatMessage` テーブル | |

## ファイルストレージの二系統

portal は CandidateFile と InterviewAttachment で **完全に異なるストレージ** を使う。混同しないこと。

| | CandidateFile | InterviewAttachment |
|--|--|--|
| ストレージ | Google Drive | Supabase Storage |
| ID フィールド | `driveFileId` | `filePath`（Supabase バケットパス）|
| ダウンロード関数 | `downloadFileFromDrive(driveFileId)` (`src/lib/google-drive.ts`) | `supabase.storage.from("interview-attachments").download(filePath)` |
| テーブル | `candidate_files` | `interview_attachments` |
| 用途 | 求職者関連書類全般（原本、BS書類、面談議事録、ブックマーク等）| InterviewRecord に紐づく添付（Notta ログ、履歴書 PDF 等）|

### 重要な含意

- T-029 Phase D-2 の Google フォーム作成は **CandidateFile（Drive）** から PDF/.txt を取得（書類タブ → 面談サブタブの category=MEETING）
- 既存 `analyze-with-intake/route.ts` は **InterviewAttachment（Supabase）** から取得（実装パターンが異なる）
- Phase D-2 の portal API（extract-resume）は CandidateFile + downloadFileFromDrive 経路を使う

## 面談関連の AI 自動生成（T-029）

| データ | source of truth | 備考 |
|--|--|--|
| Google フォーム formId / editUrl / viewUrl | InterviewRecord（isLatest=true） | T-029 Phase D-2 で追加、isLatest=true がない場合は永続化スキップ（フロント保持） |
| AI 質問テンプレ | candidate-intake の `specs/generate_form_prompt.yaml` | 21 サブカテゴリ × 業界別、決定論展開（Phase B-1.5）|
| 21 サブカテゴリ value/label | candidate-intake が source of truth、portal の `src/constants/google-form-categories.ts` は同期コピー | 同期更新ルール: candidate-intake 側更新時は portal も更新 |

## マイページ回答（応募したい/気になる）

**重要**: これが分散していて混乱の元なので明確化する。

| データ | source of truth | 備考 |
|--|--|--|
| 求職者の回答（リアルタイム）| **kyuujinPDF `JobFeedback`** | status (apply/interested/pending/excluded) |
| 送信フラグ | **kyuujinPDF `JobFeedback.is_submitted`** | 「送信」ボタン押下時のみ True |
| portal 側のミラー | portal `CandidateJobResponse` | webhook 経由で同期、auto-save時も同期（Phase A-1以降）|
| マイページ表示用の集計 | kyuujinPDF を直接参照 | bizstudio-mypage が API 取得 |
| portal ブックマークの「応募したい」フラグ表示 | portal `CandidateJobResponse` + 会社名マッチング | HistoryTab.tsx の jobResponseMap |
| CA タスク通知 | portal `Task` モデル | createOrUpdateResponseTask（10分dedup window）|

### 「件数バラバラ」になる構造的理由（既知）

| 場所 | フィルタ条件 | 結果が違う理由 |
|--|--|--|
| portal ブックマークフラグ | `CandidateJobResponse.response = WANT_TO_APPLY` ∩ ブックマーク fileName マッチ | ブックマーク PDF が存在しない求人は表示されない |
| マイページ上部タブ | `JobFeedback.status = "apply"` （Phase B 修正後）| 修正前は is_submitted=True 必須だった |
| マイページ下部 N件 | `JobFeedback.status = "apply"` | 上部タブと一致するよう修正済み |

## エントリー関連

| データ | source of truth | 備考 |
|--|--|--|
| エントリーレコード | portal `JobEntry` | |
| エントリー進行ステータス（書類選考、面接、内定）| portal `JobEntry.status` | インライン編集対応 |
| 内定承諾報告 | portal `JobEntry.acceptanceStatus` | |

## RPA関連

| データ | source of truth | 備考 |
|--|--|--|
| RPA エラー履歴 | portal `RpaError` （長期目標）| 現状は分散、portal集約は未着手 |
| Power Automate Desktop 7号機 | ローカルPC上 | Mynavi Scouting と連携 |

## 経理関連

| データ | source of truth | 備考 |
|--|--|--|
| 仕訳・伝票 | bizstudio-finance | portal とは別ホスト |
| 銀行CSV取込 | bizstudio-finance | AI分類あり |

## 重要な原則

1. **マイページ回答は kyuujinPDF が source of truth、portal はミラー**
   - portal の CandidateJobResponse は kyuujinPDF からの webhook で更新される
   - portal だけ見て判断しない（手動UPDATE すると整合性崩れる）

2. **求人マスターは kyuujinPDF が source of truth**
   - portal の externalJobId は kyuujinPDF Job.id への参照
   - 求人の company_name や URL は kyuujinPDF を見る

3. **ブックマーク PDF（ファイル）は portal と Google Drive に二重保存**
   - portal: メタデータ + driveFileId
   - Drive: 実ファイル

4. **求職者の基本情報は portal が source of truth**
   - kyuujinPDF は ShareToken.job_seeker_id しか持たない（氏名等は知らない）

5. **Job.work_location の抽出経路は媒体別に異なる**
   - HITO-Link / マイナビ / Bee: PDF → Gemini Vision で詳細住所抽出可能
   - Circus: PDF も Gemini に投げるがレイアウト由来で精度低、真の住所は URL の `__NEXT_DATA__.addressDetail` にある（未活用）
   - 詳細マトリクスは `13-data-source-paths.md` 参照
