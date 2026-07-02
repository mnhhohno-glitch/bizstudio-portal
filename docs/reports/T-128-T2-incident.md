# T-128 T2 作業中の本番不安定 インシデント報告（2026-07-02）

対象: bizstudio-portal（本番=master / Railway / PostgreSQL）
一次対応: 本番応答不能の切り分け。**破壊的操作なし・切断なし・マイグレーション再実行なし。**

## 結論（先に要点）
- **DBロックは存在しなかった。** 全診断でブロック連鎖 0 / `idle in transaction` 0 / 実行中DDL 0。
- **T-128 T2 のマイグレーションは本番に一度も適用されていない**（`candidate_files.origin` 列なし・`candidate_job_applications` テーブルなし・`_prisma_migrations` に t128 記録なし）。よって「自分の ALTER がロックした」は**否定**。
- 実体は **portal アプリ側の負荷/接続不安定**（特に重い `/api/candidates` エンドポイント）。DBは終始健全。
- 対応時点で本番は主要画面が復旧（/ 約2s、/entries 0.3s、/login 0.25s）。**セッション切断・再起動は不要と判断し実施せず。**

## 1. ブロックの根元と切断セッション
- **切断したセッション: なし（0件）。**
- 理由: ブロックしているセッションが存在しなかった。複数回の `pg_stat_activity` + `pg_blocking_pids()` 確認で **blocked=0** を一貫確認。`idle in transaction` も 0。ALTER/DDL/`candidate_files` 絡みの待機・保持クエリも 0。
- 安全規則（根元のみ・正常クエリは触らない）に従い、根元が無い以上 `pg_terminate_backend` は使用しなかった。
- 参考: 5.3時間 idle の接続が2本あったが state=idle（`idle in transaction` ではない）＝ロック非保持のプール接続。無害のため放置。

## 2. 復旧確認（HTTP応答）
診断用の有効セッションcookieで主要ページを実測:

| ページ | 応答 | 備考 |
|---|---|---|
| /login | 200 / 0.25s | 常時軽快 |
| /（トップ/ダッシュボード） | 200 / 1.6〜2.2s | 許容範囲 |
| /entries（エントリー一覧） | 200 / 0.32s | 健全 |
| /api/candidates?limit=20 | タイムアウト(45s)→502 | **重い/不安定な問題エンドポイント（後述）** |

- `/candidates`・`/interviews` への素の curl は 0.15〜0.27s で 404（RSC ルートへの直接 fetch のため。ブラウザでは正常表示）。ハングではない。
- 最終DB状態: total=4接続 / active=1 / idle-in-txn=0 / blocked=0（健全）。

## 3. Railway 側の状態
- portal 本番: Status=SUCCESS、現行デプロイ dbd787b1。再起動ループ・OOM・SIGTERM・"too many clients"・接続枯渇の兆候は**ログに無し**（直近400行を走査、該当ヒット0）。
- 意図しないデプロイ無し。**restart は実施せず**（主要画面が応答している＝「応答が戻らない」条件に非該当のため）。

## 4. 原因の確定と T2 マイグレーション安全再開手順

### 原因（確定）
- **DBロックではない**（上記の通り）。
- 事象は **portal アプリ（単一インスタンス）の過負荷/接続不安定**。決定的ログ:
  `08:25:40 Failed to fetch candidates: Error: Connection terminated unexpectedly (prisma queryRaw)`。
- `/api/candidates` は応答に 45s 超かかり、DB接続が "Connection terminated unexpectedly" で切れて 502/timeout になる。この重いエンドポイントを連続で叩くと単一インスタンスのリソース/接続プールを食い潰し、**全画面が遅くなる**（今回の症状と一致）。
- 重要: DB側の該当クエリ（`COUNT(job_entries) WHERE candidate_id IN (...)`）は **`job_entries_candidate_id_idx` を使う Index Scan で軽量**（28,235行・cost≈770）。実行中の待機は `Client/ClientRead`＝**DBがアプリの応答待ち**。すなわちボトルネックはDBではなく**アプリ側**。
- 誘因: 実運用トラフィック＋データ増によりこの経路が性能限界に接触したと推定。加えて、**本一次対応中の当方の診断プローブ（/api/candidates への45s級リクエストの連投）が一時的に悪化させた**（プローブ停止後に主要画面が復旧）。当方の T-128 作業自体（prisma generate / 無リクエストの next dev / 軽量 tsx）が本番アプリを負荷した形跡は無い。

### 推奨フォローアップ（今回は未実施・別タスク）
- `/api/candidates` の是正: ページング徹底・全件ロード回避・接続/タイムアウト処理見直し。単一インスタンスを固めない設計。
- 接続経路の確認: 本番アプリのDB接続がRailway内部ネットワークか公開プロキシ(trolley)か、Prismaプール上限・`pool_timeout`/`statement_timeout` の妥当性（"Connection terminated unexpectedly" は接続不安定の兆候）。

### T2 マイグレーションの安全再開手順（**指示があるまで再実行しない**）
本マイグレーションは additive のみ:
1. `ALTER TABLE candidate_files ADD COLUMN origin TEXT`（nullable・default無し＝PG11+ ではメタデータ変更のみで**ほぼ即時**・ACCESS EXCLUSIVE は一瞬）
2. `CREATE TABLE candidate_job_applications` ＋ index ＋ 既存 `candidates` への FK

リスクは「ADD COLUMN が一瞬とはいえ ACCESS EXCLUSIVE を要し、長時間クエリがそのテーブルの ACCESS SHARE を保持していると ALTER が待機し、後続クエリが ALTER の後ろに全部並ぶ（ロックキュー詰まり）」点。これが今回の症状“風”を作り得る唯一の経路。

安全策:
- **`SET lock_timeout = '5s';` を migration の先頭で設定**（ロックを5秒で取れなければ ALTER を失敗させ、全体を詰まらせない）。失敗時はデプロイが安全に落ちるだけ（旧版は稼働継続）。
- **業務時間外に実行**（重い `/api/candidates` 等との競合を避ける）。
- リトライは冪等（`IF NOT EXISTS`）なので、lock_timeout 失敗時はデプロイ/適用を再試行。
- 適用経路: Railway デプロイ時の `next build → prisma migrate deploy` で走る。lock_timeout を migration.sql に入れておけば自動適用も保護される。
- 適用後は `origin` 列・`candidate_job_applications` テーブル・`_prisma_migrations` の t128 記録を確認。

## 実施した操作の記録（監査用）
- ローカルの残プロセス掃除: 自分が起動した `next dev`（:3939, PID 65380 ほか node）を停止。別プロジェクトの `bizstudio-mypage`（PID 41168）は非対象のため保持。
- DB診断: 読み取りのみ（`pg_stat_activity` / `pg_blocking_pids` / `pg_locks` 相当 / `EXPLAIN`（ANALYZE無し）/ index・行数確認）。**書き込み・切断・DDL は一切なし。**
- HTTP実測: GET のみ（読み取り）。

---

# 二次対応（2026-07-02 08:40〜09:10 UTC）: 候補者詳細ページ全断 → 真因特定 → 復旧

## 経過
| 時刻(UTC) | 操作 | 結果 |
|---|---|---|
| 08:39 | before実測: 候補者詳細（5999999） | **タイムアウト（20s超）** |
| 08:40:21 | `railway service restart` 実施 | 08:40:22 Ready。**改善せず**（詳細30s超・/やエントリーまで悪化） |
| 08:44 | 本番ログ確認 | `prisma.user.findUnique` すら **P1008 Operation has timed out**（最軽量クエリも不可） |
| 08:45 | `railway ssh` で本番コンテナ内から DB へ raw TCP 試験 | **trolley.proxy.rlwy.net:40669 TCP TIMEOUT**（真因判明） |
| 08:46 | 差分試験 | 一般外部egress正常（api.anthropic.com 3ms）・DNS正常（66.33.22.236）・**staging コンテナからは同一DBへ TCP 24ms / PG 44ms** |
| 08:47 | 別プロキシ試験 | 本番コンテナから **yamabiko.proxy.rlwy.net:13741 も TIMEOUT** → プロキシ網全体へのegress断 |
| 08:48:29 | `railway service redeploy` | 新コンテナでも **TIMEOUT 継続**（同一ホスト/経路に再配置） |
| 09:0x | **リージョン変更**（GraphQL `serviceInstanceUpdate` multiRegionConfig=us-west1 → `serviceInstanceDeployV2`） | 新配置で **trolley TCP 10ms**。※新レプリカの表示リージョンは us-west2 のまま（設定投入→デプロイで健全ホストへ載替わったのが実効） |
| 09:0x | リージョン設定を us-west2 へ戻す（ステージのみ・デプロイなし） | 設定ドリフト防止（現コンテナは健全のまま維持） |

## 真因（確定）
**Railway インフラ障害**。本番サービスのコンテナが載っていたホストから、Railway TCPプロキシ網（trolley / yamabiko、66.33.22.x）への **egress のみが疎通不能**（一般インターネットegress・DNSは正常）。同一プロジェクト・同一リージョンの staging コンテナは同じDBへ 18-24ms で接続可能だったことから、特定ホスト/経路の障害と断定。アプリコード・DB・T-128作業は無関係。

- 一次対応時の「アプリ側過負荷」という結論は**不正確だった**と訂正する。当時も同じegress断が起きており、「warm接続だけ生きていた（軽いページOK）／新規接続が必要な重いページは死ぬ」が正しい説明。restart でプールが空になり全滅した事象とも整合。

## 復旧確認（after実測）
| ページ | before | after |
|---|---|---|
| 候補者詳細（5999999） | タイムアウト（25-30s超） | **200 / 0.20〜0.50s** ✓ |
| 面談詳細（/interviews/[id]） | — | 307→200 / 1.1s（権限ガードのリダイレクト含む・ハングなし） ✓ |
| /（トップ） | 30s超 | 200 / 0.29s ✓ |
| /entries | 30s超 | 200 / 0.21s ✓ |

## 恒常課題（別タスク提案・未実装）
1. **/api/candidates の45s級レスポンス**: ページング徹底・返却カラム削減。今回の障害以前から重い。
2. **job_entries COUNT の21s級集計**（一覧のバッジ用）: 集計キャッシュ or 遅延読込。インデックスは存在するためアプリ側の並列・直列化見直しが本命。
3. **DB接続経路**: 本番アプリ→DBが公開プロキシ(trolley)経由。DBが別プロジェクトのため private networking 不可。**DBを portal と同一プロジェクトへ移設**（または portal をDB側プロジェクトへ）すれば内部NW化でき、プロキシ網障害の影響を受けなくなる＋レイテンシ改善。今回の再発防止として最有力。
4. **ヘルスチェック**: `/api/health/db`（SELECT 1）を新設し Railway healthcheck に設定すれば、今回のような「アプリは生きているがDB断」を自動検知・自動再配置できる。

## Railway サポート報告文面（英語・そのまま送付可）
> **Subject:** Egress from one host to Railway TCP proxy network (trolley/yamabiko *.proxy.rlwy.net) times out — service outage
>
> **Project:** bizstudio-portal (1159a112-d0fa-4061-8138-c9ef04b94da0), service `bizstudio-portal` (0ff66b94-21cf-4526-9d98-ed28d5cea2ff), environment production (8bb80bef), region us-west2.
>
> **Summary:** Starting around 2026-07-02 ~07:00 UTC, containers of this service could not open TCP connections to Railway's TCP proxy endpoints, causing a full outage of our app (its PostgreSQL lives behind `trolley.proxy.rlwy.net:40669` in another project).
>
> **Evidence (from `railway ssh` inside the affected container):**
> - `net.connect` to `trolley.proxy.rlwy.net:40669` → **timeout** (8s+)
> - `net.connect` to `yamabiko.proxy.rlwy.net:13741` (a different TCP proxy) → **timeout** — so the whole proxy edge (resolved to 66.33.22.236) was unreachable
> - General egress fine: `api.anthropic.com:443` connects in 3ms; DNS resolution normal
> - A sibling service in the same project/environment/region (`bizstudio-portal-staging`) connected to the same proxy in 18-24ms — issue is specific to the host(s) our production service was placed on
> - Service **restart** at 08:40 UTC and **redeploy** at 08:48 UTC did not help (placed on the same broken path). Only after a region-config change + deploy (~09:05 UTC) did a new placement restore connectivity (TCP 10ms).
>
> **Recovery details (for your correlation):** A staged multi-region config change (us-west2 → us-west1) followed by `serviceInstanceDeployV2` at ~09:05 UTC produced a new placement whose replica still reported `RAILWAY_REPLICA_REGION=us-west2`, but egress to the proxy edge was healthy (TCP connect 10ms). We then reverted the staged region config to us-west2. This suggests only some us-west2 host(s) had the broken egress path.
>
> **Ask:** Please investigate the faulty host/egress path in us-west2 for this service between ~07:00-09:05 UTC (deployments `dbd787b1-9af3-4fbd-8bdb-c86e1d866bca` [restart 08:40 UTC] and the redeploy at 08:48 UTC were both placed on the broken path; deployment `990f544d-8951-4668-9bde-46a726ef6179` [~09:05 UTC] landed on a healthy one), and confirm whether other tenants were affected. We'd also appreciate guidance on how to avoid placement on that host if the issue is still present.
