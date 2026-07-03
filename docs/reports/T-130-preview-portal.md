# T-130 Phase2 step1: 求職者サイトプレビューURL発行（portal側）完了報告

実施日: 2026-07-03 ／ 対象: bizstudio-portal（master）／ 本プロンプト: portal 単独（1回目）

---

## 0. 概要

CA が候補者詳細から、その候補者の求職者サイト（`/site/`）を閲覧専用でプレビューするための
**短命（15分）の署名付きプレビューURL**を portal 側で発行する。検証・入場・ガードは mypage 側
`/site/preview`（別プロンプト）の責務。本報告の「署名仕様」は **mypage 側検証の正**。

| 項目 | 内容 |
|---|---|
| 発行API | `POST /api/candidates/{candidateId}/site-preview-url` |
| 認可 | portal 既存セッション必須（未ログイン401）。追加ロール判定なし |
| トークン取得 | kyuujinPDF `GET /api/external/mypage/by-job-seeker/{candidateNumber}`（x-api-secret）→ 既存アクティブ ShareToken の `/v/{token}` を取得。**新規発行はしない** |
| 未発行時 | 409（`reason:"no-token"`, `error:"URL未発行"`） |
| 署名鍵 | `CANDIDATE_SITE_API_KEY`（mypage との共有シークレット） |
| 有効期限 | 発行から15分（`exp` = Unix エポック秒） |
| 発行ログ | `[site-preview-url] issued by user=<id> (<email>) candidateId=<id> candidateNumber=<num> exp=<exp>` を server ログに1行 |

---

## 1. 署名仕様（★mypage 側検証はこの定義を「正」とする★）

実装の正: `src/lib/candidate-site/preview-url.ts`

### ペイロード

```
payload = { token: string, exp: number }
```

- `token`: ShareToken 文字列（kyuujinPDF の `/v/{token}` の `{token}` と同一値。例: `5999999-p6stpoj7`）
- `exp`: 失効時刻。**Unix エポック「秒」（整数）**。発行時刻 + 900秒（15分）。
- **キー順は必ず `token` → `exp`**（JSON 直列化がバイト一致するため）。

### 生成手順（portal）

1. `payloadJson = JSON.stringify(payload)`
   → 空白なしのコンパクト JSON。例: `{"token":"5999999-p6stpoj7","exp":1783074331}`
   （portal・mypage とも Next.js/TypeScript のため `JSON.stringify` 出力はバイト一致）
2. `body = base64url( utf8(payloadJson) )`
   - base64url = 標準 base64 の `+`→`-`, `/`→`_`, 末尾 `=` パディング除去
   - Node: `Buffer.from(payloadJson,"utf8").toString("base64url")`
3. `sig = base64url( HMAC_SHA256( key = CANDIDATE_SITE_API_KEY(utf8), message = utf8(body) ) )`
   - **署名対象は `body` 文字列そのもの**（base64url 済み ASCII 文字列）。**再直列化した JSON ではない**
     （JSON 正規化差異による不一致を避けるため）
   - digest も base64url（パディングなし）: `createHmac("sha256",key).update(body).digest("base64url")`
4. `pt = body + "." + sig`
   - 区切りは **ASCII ドット `.` 1個**。`body`/`sig` は base64url なのでドットを含まない（split は必ず2要素）
5. URL: `` `${MYPAGE_PREVIEW_BASE}/site/preview?pt=${pt}` ``
   - `pt` は base64url + `.` のみ = URL セーフ。**追加のパーセントエンコード不要**
   - `MYPAGE_PREVIEW_BASE` = `process.env.MYPAGE_PREVIEW_BASE_URL`（既定 `https://mypage.bizstudio.co.jp`）

### 検証手順（mypage 側が実装すべき手順・本節が正）

```
a. pt を "." で 2 分割 → [body, sig]（要素数が 2 でなければ拒否）
b. expectedSig = base64url(HMAC_SHA256(CANDIDATE_SITE_API_KEY, body))
   sig と定数時間比較（timingSafeEqual・長さ不一致も拒否）。不一致は拒否
c. payload = JSON.parse( utf8( base64urlDecode(body) ) )
d. payload.exp * 1000 < Date.now() なら「失効」として拒否
e. payload.token を閲覧専用サイトのトークンとして採用
```

- 署名鍵は portal と **同一の `CANDIDATE_SITE_API_KEY`**。
- 期限拒否（exp 経過）の実挙動テストは mypage 側プロンプトの責務（本 step では構造のみ確認）。

---

## 2. 検証結果（実施済み）

### 検証1: テスト候補者 5999999 で発行 → URL構造・exp・署名（値は伏せ字・構造のみ）

ローカル dev サーバー（実ルートハンドラ）+ 実 kyuujinPDF（by-job-seeker）+ 実 lib で発行。返却:

```
HTTP 200
{"ok":true,"previewUrl":"https://mypage.bizstudio.co.jp/site/preview?pt=<BODY>.<SIG>","exp":<UNIX_SECONDS>}
```

`pt` をデコード・署名検証した結果（構造のみ）:

| 検証点 | 結果 |
|---|---|
| `pt` の分割数（`.` 区切り） | **2**（body / sig）✓ |
| デコードした payload JSON | `{"token":"<TOKEN>","exp":<UNIX_SECONDS>}`（キー順 token→exp）✓ |
| HMAC-SHA256 署名検証（鍵で再計算し一致） | **valid=true** ✓ |
| `exp` − 発行時刻 | **+900秒（15分）** ✓（デコード時点の残差 883s = 経過分を除き一致） |
| token 一致（kyuujin `/v/{token}` の token と同一） | ✓ |

### 検証2: 未ログイン（セッションなし）で発行API → 401

```
POST /api/candidates/{5999999}/site-preview-url  （Cookie なし）
→ HTTP 401  {"error":"認証が必要です"}
```
✓ PASS

### 検証3: トークン未発行の候補者 → 409

候補者番号 5008159（kyuujin by-job-seeker が `url:null` を返す = トークン未発行）を認証済みで発行:

```
POST /api/candidates/{cmr4em1bu004w1dph7koovt4k}/site-preview-url  （認証あり）
→ HTTP 409  {"ok":false,"reason":"no-token","error":"URL未発行"}
```
✓ PASS（新規トークンを発行しないことを確認）

### 検証4: 15分経過後の pt をデコードし exp が過去である構造確認

同一 lib で `exp` を過去（now−1s）に置いたペイロードを生成しデコード:

```
payload = {"token":"<TOKEN>","exp":<PAST_UNIX_SECONDS>}
判定: payload.exp * 1000 < Date.now()  → true（＝mypage 側は「失効」で拒否すべき構造）
```
✓ 構造確認（実失効拒否の挙動は mypage 側プロンプトで検証）

### 検証5: 既存のURL発行ボタン・モーダルに退行がないこと

- `IssueSiteTokenButton.tsx`・`issue-site-token/route.ts` は**無変更**。
- `CandidateHeader.tsx` の差分は **import 1行 + 既存「求人サイトURLを発行」ボタン隣に `<SitePreviewButton>` 1行の追加のみ**（既存ボタンの props・ロジック不変）。
- 新規3ファイルは `tsc --noEmit` 型エラーなし・eslint クリーン。
  （CandidateHeader の eslint 指摘 1件は本変更前から存在する既存の age 計算 `useEffect` に対するもので、本変更とは無関係・未変更行）。

✓ PASS（退行なし）

### 補助: 署名スペックのラウンドトリップ自己テスト（独立再実装の検証器で）

valid=一致 / wrong-key=bad-sig / body改竄=bad-sig / exp経過=expired を独立実装の検証器で確認済み。
mypage 側が本仕様どおり実装すれば相互運用可能であることを実証。

---

## 3. 変更ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `src/lib/candidate-site/preview-url.ts` | 新規 | 署名仕様の実装＋厳密ドキュメント（`signPreviewToken`/`buildPreviewUrl`/`extractTokenFromMypageUrl`/`PREVIEW_TTL_SECONDS`） |
| `src/app/api/candidates/[candidateId]/site-preview-url/route.ts` | 新規 | 発行API（セッション認可・トークン取得・409・署名・発行ログ） |
| `src/components/candidates/SitePreviewButton.tsx` | 新規 | 「サイトをプレビュー」ボタン（新タブ・409トースト・誕生日ガード disabled） |
| `src/components/candidates/CandidateHeader.tsx` | 変更 | 既存URL発行ボタン隣に上記ボタン追加（import + 1行） |
| `docs/reports/T-130-preview-portal.md` | 新規 | 本報告書 |

### mypage 側への申し送り（別プロンプト）

- `/site/preview?pt=...` を新規実装。**本報告 §1 の検証手順（a〜e）を正**として実装すること。
- 署名鍵は portal と同一の `CANDIDATE_SITE_API_KEY`（環境変数）。
- `exp` は Unix「秒」。`payload.exp * 1000 < Date.now()` で失効判定。
- プレビューは閲覧専用（誕生日認証をバイパスして表示。書き込み系は無効化する想定）。

---

## 4. コミット / デプロイ

- コミット: __（追記）__
- Railway デプロイ: __（追記）__

### セキュリティ確認

- 秘密値（`CANDIDATE_SITE_API_KEY` 等）を**URLクエリに直接載せない**（HMAC 署名のみ載る）。
- `/v/` の既存プレビュー（`?admin=true` + `x-api-secret` 直付け）方式は**流用していない**。
- 発行は既存セッション必須（未ログイン401）。発行ログを server に1行出力。
- ローカル検証用 `.env.local`（実 `KYUUJIN_API_SECRET` を含む）は検証後に削除済み・コミット対象外。
