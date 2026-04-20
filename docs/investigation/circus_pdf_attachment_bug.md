# Circus送信時のPDF添付バグ + スクロール位置バグ 調査レポート

**調査日:** 2026-04-21
**調査者:** Claude Opus 4.6

---

## バグ1: Circus送信時にPDFが添付されていない

### 原因特定

**原因コミット:** `b820c32` (2026-04-17 06:03)
- コミットメッセージ: `fix: Circus送信時のメモ添付をPortalから削除（kyuujinPDF側で添付する運用に変更）`
- 2ファイル、212行削除

**削除された処理（send-to-job-tool/route.ts から97行削除）:**

1. **メモ内容のパース処理** — Circus URLからジョブID（例: `420121`）を抽出するロジック
2. **PDFファイル名リネーム処理** — `{会社名}_No{circusId}.pdf` 形式にリネーム
3. **2段階マッチング戦略:**
   - 優先1: 求人番号マッチ（PDF `_No420121` ↔ メモ circusId `420121`）
   - 優先2: 会社名ファジーマッチ（正規化して比較）
4. **メモインポートAPIコール** — `POST /api/projects/{projectId}/memos/import` が削除

**削除された処理（HistoryTab.tsx から115行削除）:**

1. `memoFile` / `memoFromBookmark` state（メモファイル選択UI）
2. ブックマークからの `.txt` ファイルドロップダウン選択
3. ドラッグ＆ドロップでのメモファイルアップロード
4. Circus選択時の `if (!memoFile && !memoFromBookmark) return;` バリデーション

### 現在のCircus送信フロー（壊れている理由）

```
Portal                                  kyuujin-pdf-tool
───────                                 ────────────────
1. PDFをGoogleDriveから              
   ダウンロード                        
2. 元ファイル名のまま                   → /api/upload/.../files/batch
   アップロード                           (PDFは保存されるが、メモとの紐付けなし)
3. Step 4 スキップ                      → メモインポート呼ばれない
4. 抽出開始                             → /api/extraction/.../extract
5. メモ画面(-4)へリダイレクト           → /projects/{id}/memos?unit=...&key=...
                                          メモ0件 → 「メモがありません」表示
```

**核心問題:** メモインポート（Step 4）がスキップされたため、kyuujin-pdf-tool側にメモデータが存在しない。ユーザーは手動でメモ帳ファイルをインポートする必要があるが、**そのメモ帳ファイルはPortal側で選択するUIも削除されている**。

### kyuujin-pdf-tool側の状況

MemoEditPage.tsx の確認結果:
- Circus案件の場合、メモ帳インポートUI（ドラッグ＆ドロップ + テキスト直接入力）は**表示される**（192-273行）
- ただし、Portalからの遷移時にメモ内容が自動設定されるわけではない
- ユーザーが手動で `.txt` ファイルをドロップするか、直接入力する必要がある

### 修正方針提案

**案A（推奨）: Portal側でメモ添付UIを復活 + メモインポートAPI呼び出し復活**

- HistoryTab.tsx にCircus選択時のメモファイル選択UIを復活
- send-to-job-tool/route.ts に以下を復活:
  - メモ内容パース → CircusID抽出
  - PDFファイル名リネーム（`{会社名}_No{circusId}.pdf`）
  - `POST /api/projects/{projectId}/memos/import` 呼び出し
- HITO-Link/マイナビルートには影響なし

**案B: Portal側でメモ添付UI復活 + メモ内容をURLパラメータで渡す**

- メモ内容が大きい場合URLに収まらないリスクあり → 非推奨

**案C: kyuujin-pdf-tool側でメモファイル添付を完結させる（現在の意図通り）**

- 現状でもkyuujin-pdf-tool側のメモインポートUIは存在する
- ただし、ユーザーがPortal→kyuujin-pdf-tool遷移後に**手動で**メモ帳を添付する運用になる
- 元の仕様（PDFが添付済みで表示される）とは異なるUX

---

## バグ2: メモ添付画面が最下部スクロール位置で開く

### 原因特定

**対象ファイル:** `kyuujin-pdf-tool/frontend/src/pages/MemoEditPage.tsx`

**ページ構造（上から下）:**
1. ヘッダー（「プロジェクトに戻る」リンク + 「メモ生成/編集」タイトル）— 142-157行
2. 未紐付けアラート — 160-175行
3. メモ帳インポートUI（Circus案件のみ）— 192-273行
4. メモ一覧 — 276-310行
5. ナビゲーション（「ファイル投入に戻る」「抽出開始＆プレビューへ」）— 312-357行

**原因:** React SPAのクライアントサイドルーティングで、ページ遷移時にスクロール位置がリセットされない。

確認した箇所:
- `main.tsx`: `BrowserRouter` に `ScrollRestoration` なし
- `App.tsx`: ルート変更時の `scrollTo(0,0)` なし
- `MemoEditPage.tsx`: `useEffect` でのスクロール制御なし
- `Layout.tsx`: スクロールリセットロジックなし

React Router v6のSPAでは、ブラウザのネイティブなページ遷移と異なり、ルート変更時にスクロール位置が自動リセットされない。外部サイト（Portal）からの遷移ではブラウザが新しいページロードを行うため通常は最上部に表示されるが、kyuujin-pdf-tool内でのSPA遷移（例: upload → memos）ではスクロール位置が保持される。

**追加要因:** `react-beautiful-dnd` (v13.1.1) のDrappableコンテナが `MemoList.tsx` (77行) で使用されており、ドラッグ操作時にウィンドウ全体の自動スクロールが発生する可能性がある。

### 修正方針提案

**案A（推奨・シンプル）:** `MemoEditPage.tsx` の先頭に `useEffect` で `window.scrollTo(0, 0)` を追加

```tsx
useEffect(() => {
  window.scrollTo(0, 0)
}, [])
```

**案B（全ページ対応）:** `App.tsx` or `main.tsx` にグローバルな `ScrollToTop` コンポーネントを追加

```tsx
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}
```

---

## まとめ

| バグ | 原因 | 修正対象リポジトリ | 修正の複雑さ |
|------|------|-------------------|-------------|
| バグ1 | コミット b820c32 でメモインポート処理が丸ごと削除された | bizstudio-portal（メイン） | 中（削除コードの選択的復活） |
| バグ2 | SPA遷移時のスクロール位置未リセット | kyuujin-pdf-tool | 低（useEffect 1行追加） |
