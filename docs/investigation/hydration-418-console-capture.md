# Hydration #418 Console Capture Report

Captured: 2026-04-19T20:55:50.363Z
Environment: dev server (npm run dev), Puppeteer headless Chrome

## サマリー

| URL | メッセージ数 | エラー数 | Hydrationエラー数 |
|---|---|---|---|
| `/candidates/cmo2tcd8a001i1dqb2zit3e5k?tab=interview` | 5 | 1 | 0 |
| `/candidates/cmo2tcd8a001i1dqb2zit3e5k` | 3 | 0 | 0 |
| `/candidates/cmo2tcd8a001i1dqb2zit3e5k?tab=history` | 9 | 4 | 0 |

## /candidates/cmo2tcd8a001i1dqb2zit3e5k?tab=interview

### エラー (1件, favicon除外)
```
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### Hydrationエラー (0件)
```
(なし)
```

### 全コンソール出力 (5件)
```
[INFO] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[LOG] [HMR] connected
[HTTP_404] http://localhost:3000/favicon.ico
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
[LOG] [mypage-client] fetched: [object Object]
```

## /candidates/cmo2tcd8a001i1dqb2zit3e5k

### エラー (0件, favicon除外)
```
(なし)
```

### Hydrationエラー (0件)
```
(なし)
```

### 全コンソール出力 (3件)
```
[INFO] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[LOG] [HMR] connected
[LOG] [mypage-client] fetched: [object Object]
```

## /candidates/cmo2tcd8a001i1dqb2zit3e5k?tab=history

### エラー (4件, favicon除外)
```
[HTTP_500] http://localhost:3000/api/candidates/cmo2tcd8a001i1dqb2zit3e5k/jobs
[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error)
[HTTP_500] http://localhost:3000/api/candidates/cmo2tcd8a001i1dqb2zit3e5k/jobs
[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error)
```

### Hydrationエラー (0件)
```
(なし)
```

### 全コンソール出力 (9件)
```
[INFO] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[LOG] [HMR] connected
[LOG] [mypage-client] fetched: [object Object]
[LOG] [Fast Refresh] rebuilding
[LOG] [Fast Refresh] done in 164ms
[HTTP_500] http://localhost:3000/api/candidates/cmo2tcd8a001i1dqb2zit3e5k/jobs
[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error)
[HTTP_500] http://localhost:3000/api/candidates/cmo2tcd8a001i1dqb2zit3e5k/jobs
[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error)
```

## 結論

dev サーバー + Puppeteer (headless Chrome, 拡張機能なし) では **Hydration #418 エラーは再現されなかった**。

考えられる理由:
1. dc4c7ae の修正で Hydration mismatch が解消された
2. ブラウザ拡張機能が DOM を注入し、React 19 の厳格なハイドレーションチェックに引っかかっている
3. 特定のデータ条件でのみ発生する（今回テストした候補者データでは再現しない）

### 推奨アクション
- staging 環境で **Chrome シークレットモード（拡張機能無効）** でアクセスして再現確認
- それでも再現する場合は、staging の本番ビルドに特有の問題（minification 等）の可能性
