# 08. 過去のバグパターン辞書

## カテゴリA: 名称不一致系

### A-1. AI側 vs UI側で選択肢名称が違う
**症状**: AIが解析した値が UI セレクタに出ない（空欄になる）
**原因**: candidate-intake と portal の UI セレクタで enum が分散管理

**例**:

| 項目 | AI側（修正前） | UI側（修正後） | 対応状況 |
|--|--|--|--|
| 送付予定 | 「求人送付予定」（candidate-flags.ts 求人送付フラグ）| 「送付予定」「送付なし」| ✅ DB 50件マイグレ済 + AI側enum同期済 |
| 連絡手段 | LINE設定フラグ → lineSetupFlag（contactMethod とは別カラム）| 「LINE WORKS」削除 | ✅ AI書込先が別カラムのため LINE設定フラグ は変更不要 |

**関連ケース**:
- T-051 Step 1（面談入力フォーム ドロップダウン整理、DBマイグレーション「求人送付予定」31件含む50件を「送付予定」に統一）
- T-051 Step 2（AI解析側 flags.ts + candidate-flags.ts の enum 同期、FLAG_LIST_TSV 同時更新）

## カテゴリB: ファイル名照合失敗系

### B-1. 新形式PDFのAI評価保存失敗
**症状**: ブックマーク一覧で特定のPDFだけ AI評価が空欄
**原因**: `extractSearchNames()` が新形式（Bee等）にマッチしない

### B-2. 移動バグでマイページに重複求人
**症状**: 「対象外復活→移動」操作後、マイページに同じ求人が2つ
**原因**: 新規 processing_unit_id で重複チェックがスコープ外になる

## カテゴリC: マイページ件数不整合系

### C-1. 管理者プレビュー全件未回答
**原因**: admin-preview が `_resolve_feedback_status()` を使っていなかった

### C-2. 「応募したい」件数が3箇所バラバラ
**原因**: portal/マイページ上部/マイページ下部で集計ロジックが異なる

## カテゴリG: 媒体別経路混同系

### G-1. Circus を「Gemini 不使用」「PDF 持たない」と誤認
**真実**: Circus も PDF を持ち Gemini Vision に渡される。ただし精度が低い。

### G-2. 媒体判定 regex のスペース固定で新形式 PDF がフォールスルー

**症状**: 新媒体（例: Bee）の PDF が他媒体（例: HITO-Link）として誤判定される。本番 DB の job_db 別件数を集計すると「新媒体だけ 0 件」という分布になり、自動判別コードが追加されているのに本番では一度も判定されていない状態が観測される。

**原因の構造**:
- kyuujinPDF `_determine_job_identifiers()` の各媒体判定 regex が `\s+`（スペース必須）固定になっている
- 新媒体の PDF テキストが「求人ID：123202」のように全角/半角コロン区切り形式の場合、新媒体判定 regex にマッチしない
- 次に評価される HITO-Link 判定 regex が `[：:]?` でコロンを許容 + `[A-Za-z0-9\-]+` で純数字も許容するため、フォールスルーで HITO-Link として誤判定が成立する
- portal は kyuujinPDF API レスポンスをミラーしているだけなので、portal 側のエントリー管理画面にも誤った求人DB値が表示される

**対処**:
- kyuujinPDF 側: 判定 regex のセパレータを `[\s：:]+` に拡張、距離制限も緩和
- kyuujinPDF 側: ファイル名ベースのフォールバック判定を追加（OCR 失敗時のセーフティネット）
- portal 側: 過去エントリー済みデータの `JobEntry.jobDb` も両方マイグレーション必要（一方向コピーで自動同期しないため、別途 UPDATE）

**関連ケース**:
- T-028: Bee 媒体が本番で 1 件も判定されておらず、7 件が kyuujinPDF 側で HITO-Link として誤記録、portal 側には未エントリーで 0 件
- 修正コミット: kyuujinPDF a4e7600 / portal 9b22b94

## カテゴリH: 採番・ID 生成系

### H-1. 採番ロジックの加算値が +1 でなく +100 になっていた

**症状**: 求職者新規登録モーダルで自動採番される `candidateNumber` が直前番号 +1 でなく、100 単位で飛んでいた(5005795 → 5007995、差分 +2200)

**原因の構造**:
- `src/app/api/candidates/next-number/route.ts` の採番ロジック
- L24: `nextNumber = maxNum + 100` が本来 `+ 1` であるべき(誤実装の名残)
- L26: 初期値 `5000100` も `5000001` であるべき(同じ +100 設計の名残)
- 衝突回避ループ(L30-39)は正しく +1 で進む実装、ここは無関係
- DB 側にデータ異常はなく、コードに閉じた問題だった

**対処**:
- 採番加算値を 1 に修正(L24, L26 の 2 行)
- 既存の異常データ(5005895〜5007895、22 件)は外部連携(kyuujinPDF の job_seeker_id 等)への影響大のため振り直さず残置
- 新規採番は最大値 +1 で再開

**教訓**:
- 採番ロジックは単一箇所に閉じているか確認(`grep` で `nextNumber`, `next-number`, `Math.max.*candidate` 等)
- **DB 分布調査と実コード調査を両方実施しないと、データ起因かコード起因か切り分けられない**
- 仮説で進めず実コードを行番号付きで取得、判明事実のみ報告するフロー(T-050 Phase 1 設計)が有効

**関連ケース**:
- T-050(2026/5/12)
- 修正コミット: `59ce485`
- 異常データ流通範囲: 2026/5/7〜5/12 の 22 件、kyuujinPDF / マイページの `job_seeker_id` として外部流通済み

## カテゴリI: コンポーネント再利用・props 移植系

### I-1. Googleカレンダー連携ボタン無反応（onConnect 移植漏れ）

**症状**: 新ダッシュボード（日報タブ）で「🔗 Googleカレンダー / ToDo を連携」「再認証」を押しても無反応。hover スタイルは効くがクリックしても Google 認可画面に遷移しない。

**原因の構造**:
- `src/components/dailyReport/DailyReportView.tsx` で共通コンポーネント `CalendarConnectButton` を再利用した際、`onConnect` に `() => void fetchCalendar()`（`/api/calendar/events` のイベント再取得）を渡していた
- 本来の `onConnect` は OAuth 認可フロー（`/api/calendar/auth` で authUrl を取得 → `window.location.href` でリダイレクト）であるべき（正：`SchedulePanel.tsx`）
- T-069 で日報タブにスケジュール機能を移植した際、ハンドラの中身だけが別物（イベント取得）になり、OAuth フロー呼び出しが漏れた
- 連携済み時の「再認証」ボタンも同じ `onConnect` を使うため、同時に無反応だった

**露呈の構造**:
- 既存ユーザーは旧ダッシュボード時代に連携済み（`isConnected=true`）で連携ボタン自体が表示されないため気づかない
- 新人アカウント・連携解除後の再連携でのみ未連携状態（`isConnected=false`）になり、初めて露呈する
- User / Employee リンクや role とは無関係（全未連携ユーザーで発生する性質のバグ）

**対処**:
- `DailyReportView.tsx` の `onConnect` を `SchedulePanel.tsx` と同じ OAuth フロー呼び出しに差し替え（1 箇所）
- `onDisconnect`・`SchedulePanel.tsx`・`CalendarConnectButton.tsx` 本体は変更なし

**教訓**:
- **共通コンポーネントを再利用するとき、props で渡すハンドラが元コンポーネントの意味（ここでは「連携＝OAuth 遷移」）を保っているか確認する**
- 同じ props（`onConnect`）が複数のボタン（連携・再認証）から共有されている場合、片方のバグは両方に波及する

**関連ケース**:
- T-069（日報タブ移植時の移植漏れ）
- 修正コミット: `12f6fea`

## カテゴリJ: 外部API・モデル依存系

### J-1. 退役した Claude モデルID のハードコードによるAIエラー

**症状**: 日報AIボタン（および予定作成「✏️AI」・予定レビュー・RPAエラーチャット）を押下直後にエラー。フロントには 500「AIの応答取得に失敗しました」が出る。即時エラーで、AIの応答が一切返らない。

**原因の構造**:
- 日報/スケジュール/RPAエラーの各AI機能は **Anthropic Claude** を使用（`ANTHROPIC_API_KEY` / クライアント `src/lib/claude.ts`）。**Gemini ではない**。
- 各ルートがモデルID `claude-sonnet-4-20250514` をハードコードしていたが、このモデルは **2026-06-15 に退役**。退役モデルIDは上流 Anthropic API で **`404 not_found_error`（`model: ...`）** を返す。
- 各ルートが 404 を `catch` して 500 に変換しフロントに返すため、フロント側では「コードバグ風の 500」に見えるが、真因は上流 404（モデルID無効）。
- キー失効・課金・quota の問題ではない（401/403/429 ではない）。後継は **`claude-sonnet-4-6`**（ドロップイン後継。system/messages・`max_tokens` 変更不要）。

**切り分け（Anthropic API のエラー種別）**:
- **401 `authentication_error`** = APIキー無効・欠落
- **403 `permission_error` / `billing_error`** = 権限不足・課金
- **429 `rate_limit_error`** = レート/quota/クレジット
- **404 `not_found_error`** = **モデルID無効/退役**（本ケース）
- **500 `api_error`** = 上流の一時障害（コード側 catch の 500 とは別物）

**対処**:
- 退役モデルID `claude-sonnet-4-20250514` を後継 `claude-sonnet-4-6` に全文置換（route.ts のリトライ箇所含む）。本件では daily-report（assist/chat）・schedule（chat/review）・rpa-error チャット（message/extract）の **6ファイル10箇所** + 知識ドキュメント（03/06/14）を更新。
- quota/課金確認が必要な場合の確認先は **Anthropic Console**（platform.claude.com）。Google AI Studio / Cloud Console は Gemini 用で無関係。

**教訓**:
- ハードコードした Claude モデルIDは**退役日を要監視**。退役は突然 404 を引き起こす（本件は退役2日後に発覚）。
- 切り分けは **HTTPステータス＋`error.type`** で行う（401/403/429/404/500）。フロントの 500 だけ見てコードバグと決めつけない。
- 将来は **モデルIDを定数集約**して一箇所で更新できるようにする（別タスク）。→ **対応済み: モデルIDは `src/lib/claude.ts` の `CLAUDE_MODEL_DEFAULT` に集約済み。次の退役時はここ1箇所を変更すればよい。**
- 退役モデルは複数機能で共有されがち。1機能で発覚したら **リポジトリ全体を grep** して同じIDの他用途も同時に直す。

**関連ケース**:
- 調査: 日報AI退役モデル調査（2026-06-17）
- 修正コミット: （本コミット）

## カテゴリK: 集計フィルタ系

### K-1. 応募日別（applied）期間フィルタで配信枠の deliveryDate を事前フィルタとして使うと月またぎ応募が脱落する

**症状**: スカウト集計の `dateMode=applied`（応募日別）で、6月の応募数が実際の 125 件でなく 113 件と表示される。マイナビ管理画面上は 6/1 に 11 名応募しているが、stats API は 7 名しか返さない。

**原因の構造**:
- stats API が配信枠を `deliveryDate >= from AND deliveryDate <= to` でフィルタしてから、各枠の `linkedCandidates` を集計していた
- 5月配信 → 6月応募（月またぎ）のケースで、配信枠が5月のためフィルタから除外され、応募者がカウントされない
- 6/1 の 11 名のうち 4 名は 5月配信枠（5/13, 5/26, 5/30, 5/31）に紐付いており、6月クエリで脱落
- `dateMode=sent` では正しい（配信日で切る設計のため）。`dateMode=applied` のみ影響

**対処**:
- `dateMode=applied` は配信枠フィルタを使わず、**候補者テーブルから直接** `applicationDate` or `createdAt` の JST 暦日で期間フィルタする
- 集計対象条件（`scoutDeliverySlotId != null` かつ枠の `isAggregationTarget = true`）は WHERE で維持
- candidates API の `appliedDate` 経路も同じロジックに統一

**教訓**:
- **「応募日でバケットを切る」と「応募日で期間フィルタする」は両方とも応募日ベースで行う**。バケットだけ応募日、フィルタは配信日という混在設計は月またぎを生む
- 差分の構造: sent=111+2=113、applied=111+14=125（overlap=111、sent-only=2、applied-only=14 うち 13 件は 5月配信→6月応募）

**関連ケース**:
- T-135 step9（2026/7/6）: stats API + candidates API 修正。修正コミット: `1fb40ff`

## バグ調査の標準フロー

1. このパターン辞書を確認
2. データソースの不整合？ → `02-data-sources.md` 参照
3. データの正解はどこ？ → 各リポジトリの DB を直接クエリ
4. 集計ロジックは何箇所ある？ → 表示位置と集計関数を全部洗い出す
