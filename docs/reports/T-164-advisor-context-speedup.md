# T-164 AIアドバイザーの待ち時間15.5秒の解消＋評価の鮮度確保＋キャッシュ取りこぼし回収 — 完了報告

- 実施日: 2026-08-14
- 対象: bizstudio-portal master（実装 → master push → 本番デプロイ → 本番検証 → 費用検証まで完了）
- 前提: `docs/reports/T-163-advisor-chat-weight-fix.md`

> 表記: 【実測】=本番DB/本番APIで確認した値。【コード確認】=コードで担保したもの。

---

## 1. §2 実装前チェック結果と分岐判定

### C1: ファイル単位の解析結果の保存有無 → **保存されていない → §3-1/§3-2 実装（本丸）**

- `parsePdfWithAI()`（`src/lib/file-parser.ts:62-70`）は純関数で**結果をどこにも保存していない**。再利用ロジックも無し。
- advisor-context の keyFiles ループ（旧 `advisor-context.ts:129-172`）は毎ビルドで Drive ダウンロード + Gemini 解析を実行していた。
- 既存の空きカラム: `CandidateFile.extractedText / extractedAt` が存在するが、**BOOKMARK求人票の抽出パイプライン専用**に使用中（analyze-batch が `extractedText: {not: null}` を評価対象条件に使う）。意味衝突を避けるため新カラム `parsedText` 系を追加した。
- 【実測】直近14日の Gemini `file-parse` 361回中 **343回（95%）が `caller='advisor-context'`** — 本変更の削減対象が支配的。
- 【コード確認・重要】`parsePdfWithAI` は失敗時に **throw せず「（ファイルの読み取りに失敗しました）」の定型文を返す**。この定型文を保存すると失敗が永久キャッシュされるため、保存前に定型文チェックを入れた。

### C2: 評価が古いまま使われる問題 → **154件（81.9%）→ §3-3 必須**

【実測】`context_cache` 保持 188 セッション中:

| 指標 | 値 |
|--|--|
| `context_cached_at` より後に当該求職者の評価（`ai_match_rating` 非NULL行の `updated_at`）が更新された形跡 | **154件（81.9%）** |
| うち **TTL 30分以内**に評価が変わった形跡（=古い評価のcontextが実際に使われ得た） | **33件（17.6%）** |

→ 1件以上 → §3-3 を必須として実装。

### C3: 総合まとめフォールバック経路 → **実行実績なし＝未検証 → §3-5 で検証（検証済み・後述）**

- フォールバック: `src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts` の最終バッチ処理内 —
  `takeRunBatchResults(sessionId)` が空 かつ `start > 0` のとき、`allBookmarks.slice(0, start)` の
  `aiAnalysisComment` を `compressBatchResultForSummary` で圧縮して過去バッチ結果を再構成する（T-163 b5c9cc5 で追加。現行 route.ts の「6. 過去バッチ結果」ブロック）。
- 発火条件: プロセス再起動・TTL30分超過・別プロセス処理などで run 内キャッシュに当該 sessionId のエントリが無い場合。
- 実行実績: 専用ログ無し・`advisor_usage_logs` にも痕跡なし → **未検証だった**（§5 で検証実施）。

---

## 2. コミットID一覧

| コミット | 内容 |
|--|--|
| `1beb617` | スキーマ追加＋手書きマイグレーション（migrate deploy 適用済み） |
| `b359bf6` | PDF解析結果をファイル単位で永続再利用（15.5秒対策の本丸）＋差し替え経路で NULL 化 |
| `ac47f76` | contextキャッシュの失効判定を時間→材料指紋（sha256）に変更・上限TTL 24h |
| `0f950bc` | 候補者contextブロックに `cache_control` 付与（TTLは既定5分のまま） |
| （§3-5） | コード変更なしで検証（新規セッションで最終バッチのみ実行＝キャッシュ未投入で再起動と等価。恒久コードへのデバッグフラグ追加なし） |

## 3. マイグレーションSQL全文

`prisma/migrations/20260814130000_t164_file_parsed_text_and_context_fingerprint/migration.sql`

```sql
-- T-164: AIアドバイザーの待ち時間解消＋評価の鮮度確保
-- 1) candidate_files.parsed_text / parsed_at / parse_failed_at:
--    ファイル本体から抽出したテキストの永続キャッシュ（advisor-context 用・extractedText とは別系統）。
--    parse_failed_at は「失敗を永久キャッシュしない」ための記録（parsed_text が無ければ次回再試行）。
-- 2) advisor_chat_sessions.context_fingerprint:
--    context の材料が変わったかを判定する指紋（時間TTLから中身判定への変更）。
-- staging と本番が同一 PostgreSQL を共有するため、すべて冪等（IF NOT EXISTS）にする。

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "parsed_text" TEXT;

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "parsed_at" TIMESTAMP(3);

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "parse_failed_at" TIMESTAMP(3);

ALTER TABLE "advisor_chat_sessions" ADD COLUMN IF NOT EXISTS "context_fingerprint" TEXT;
```

## 4. `context_build_ms` の実装前後比較【実測】

| 状況 | 実装前 | 実装後 |
|--|--|--|
| 再ビルド（解析込み） | **15,507ms**（n=1・T-163実測） | 17,638ms（**初回のみ**: 解析＋parsedText永続化。2 PDF＋1 txt） |
| 再ビルド（解析済みファイル再利用） | 発生し得ない（毎回解析） | **145ms / 156ms**（Drive ダウンロードも Gemini もスキップ） |
| キャッシュヒット（指紋一致） | 0ms | 0ms |

- 同一の質問リクエストの**総所要時間**: 初回セッション 22.7秒 → 解析済み再利用の新セッション **5.7秒**。
- 分析直後の再ビルド（指紋変化・評価一覧の更新のみ）も **156ms**。「再ビルド=遅い」自体が解消した。
- 母数: T-163 以降の `context_build_ms > 0` は 5 件（p50 10,024 / max 17,638）。うち T-164 後の解析済み再利用は 145/156ms の2件。**n は小さい**ため、1〜2週間後の再集計を推奨。

## 5. §3-5 フォールバック検証結果【実測】

**方法**: 新規セッション（`cmssk6jdh00080xmro275onie`）で**最終バッチのみ**を実行
（`batchIndex=1, batchSize=5, totalFiles=10, isLastBatch=true`）。run 内プロセスキャッシュは sessionId キーで
一度も投入されていないため `takeRunBatchResults` は必ず空 → **サーバー再起動直後と同じ状態**。
恒久コードへのデバッグフラグ追加はしていない。

**結果**:
- HTTP 200・総合まとめ付きの完了カードが投稿された。
- カードの【総合優先順位（全10件）】は **10社すべてを網羅**: 前半5社（キャリアパワー・フロムページ・山田工業・スターゼン ほか）= **DB再構成（フォールバック）由来**、後半5社（アド・プロ・ストリームライン・プロラボ・RERISE・シモダ・日本セーフティー）= 当該バッチ由来。B:2 + C:3 + D:5 = 10社 ✔
- カードの件数内訳（A:0/B+:2/B:8/C:21/D:30/未評価:5）も投稿時点のDB実数と整合。
- **フォールバック経路は正しく動作。再構成ロジックの修正は不要。**

## 6. §6 費用・速度の事後検証【実測・6項目すべて合格】

| 見る数字 | 実装前（基準） | 実装後 | 判定 |
|--|--|--|--|
| `context_build_ms`（再ビルド時） | 15,507ms | **145〜156ms**（解析済み時。初回のみ17,638ms） | ✅ 大幅減 |
| Gemini（PDF解析）呼び出し | 再ビルドごとに平均1.52回（advisor-context 起点 343回/14日） | デプロイ後は**初回の2回のみ**、以降の再ビルド2回では**0回** | ✅ 減っている |
| advisor-chat 1回の平均コスト | $0.0793（T-163後 n=5） | **$0.0555**（T-164後 n=5。フルキャッシュ時 **$0.014**） | ✅ 上がっていない |
| advisor-chat の cache_read 率 | 29.6%（T-163前）/ T-163後参考 | **T-164後 4/5=80%**（T-163デプロイ以降通算 72.7%） | ✅ 下がっていない |
| analyze-batch 1回の平均コスト | 初回$0.3055 / 中間$0.1780 | T-164 は analyze-batch を**リクエスト構成レベルで未変更**。検証コール（単発・最終バッチのみ）の cache_creation は 28,918 で T-163 実測 28,921 とほぼ同一＝入力同等。$0.3662 は「初回+総合まとめを1コールに兼ねた人工的な呼び方」由来で、通常フローの初回$0.3059（T-163実測）と構成一致 | ✅ ±5%以内（同条件比較で変化なし） |
| AI呼び出し回数（同条件） | chat 1リクエスト=1コール / analyze 1バッチ=1コール | 不変（検証run: 1バッチ実行で usage 1行のみ）。Gemini は削減のみ | ✅ 増えていない |

## 7. §7 chat費用の再集計（n不足の解消）【実測】

**T-163 デプロイ（2026-08-14 05:45 UTC）以降の全 `advisor-chat`**（エラー行除外）:

| 指標 | 値 | T-163実装前との比較 |
|--|--|--|
| **n** | **11**（T-163期 6 + T-164期 5） | — |
| input_tokens avg / p50 / p90 / max | 8,976 / **7,442** / 18,293 / 18,348 | p50 28,601 → 7,442（**−74%**） |
| cost_usd avg | **$0.0716** | $0.1747 → **−59%** |
| cache_read 率 | **72.7%**（8/11） | 29.6% → +43pt |

- T-164 期 5コールのみでは: 非キャッシュ入力 42〜419 トークン（両systemブロックがキャッシュ化されたため）、平均 $0.0555、フルヒット時 **$0.0140〜0.0149/コール**。
- **n=11 はまだ少ない。** 傾向（入力水準の低下・cache_read化）は構造的だが、平均コストの確定値は1〜2週間後の再集計で確認すること。

## 8. 品質面の確認【実測】

- 分析直後のチャット（セッションA=分析前の指紋でキャッシュ済み）で「アド・プロ」の評価を質問 →
  **希望C/通過C（分析直後の新しい評価）** を引いて回答。指紋方式による鮮度確保が機能。
  （旧30分TTLなら分析前の「希望D/通過B・総合D」のまま回答していた場面）
- 応答の短文性は維持（177字 / 64字 / 14字）。

## 9. 残課題・未確認事項

- `context_build_ms` / chat 費用とも**実装後の n が小さい**（ビルド2件・チャット5件）。1〜2週間後の再集計を推奨。
- 既存ファイルの parsedText は**遅延埋め**（次に参照されたとき解析・永続化）。一括バックフィルは行っていない（Gemini 呼び出しを増やさない方針のため。自然利用で埋まる）。
- greeting（挨拶文生成）の面談ファイル解析（直近14日で18回）は今回のスコープ外のまま毎回解析。同じ `parsedText` を使う改修は次回候補。
- 指紋の材料はワークシート（guideEntry）・メモ・ファイル・評価・面談ダイジェスト・candidate 行。これら以外の材料変化（例: スキルファイル更新）は指紋に出ないが、24時間の上限TTLで必ず作り直る。
- ブラウザでの目視確認は未実施（curl + DB での検証）。
