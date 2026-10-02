#!/usr/bin/env bash
# T-XXX step3: 本番DBを pg_dump（カスタム形式）で取り、同じスナップショットの件数表を JSON で出す。
#
# サーバーと同じ版（PostgreSQL 17）の pg_dump / psql を使うため、postgres:17 コンテナの中で実行する。
#   docker run --rm -v "$WORK:/work" -e DB_URL postgres:17 bash /work/pg-dump-with-counts.sh /work/out.dump /work/counts.json
#
# 件数表とダンプの整合: psql のセッションで REPEATABLE READ のトランザクションを開き、
# pg_export_snapshot() で得たスナップショットを pg_dump --snapshot に渡す。
# 件数も同じトランザクション内で数えるので、深夜バッチが同時に書き込んでいても
# 「ダンプの中身」と「件数表」は必ず一致する（復元テストで突き合わせる前提）。
#
# 本番DBへの操作は読み取りだけ（BEGIN READ ONLY）。
# 接続文字列は環境変数 DB_URL からのみ読み、標準出力・エラーには出さない。

set -euo pipefail

OUT_DUMP="${1:?出力ダンプのパス}"
OUT_COUNTS="${2:?出力件数表のパス}"
: "${DB_URL:?環境変数 DB_URL が未設定}"

# 件数表: public スキーマの全テーブルを count(*) で数える。個人情報は一切含まない。
read -r -d '' COUNTS_SQL <<'SQL' || true
SELECT json_build_object(
  'serverVersion', current_setting('server_version'),
  'database', current_database(),
  'tableCount', count(*),
  'tables', json_object_agg(t.table_name, t.cnt ORDER BY t.table_name)
)
FROM (
  SELECT table_name,
         (xpath('/row/cnt/text()',
                query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', table_schema, table_name), false, true, '')
         ))[1]::text::bigint AS cnt
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
) t;
SQL

# psql を対話セッションとして開き、スナップショットを輸出してもらう。
# -q で BEGIN 等のコマンドタグを抑止し、-A -t で値だけを受け取る。
coproc PSQL { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -A -t -X; }

echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" >&"${PSQL[1]}"
echo "SELECT pg_export_snapshot();" >&"${PSQL[1]}"
read -r SNAPSHOT_ID <&"${PSQL[0]}"
if [ -z "$SNAPSHOT_ID" ]; then
  echo "スナップショットの輸出に失敗しました" >&2
  exit 1
fi
echo "[pg-dump] snapshot=$SNAPSHOT_ID"

echo "[pg-dump] pg_dump 開始 ($(pg_dump --version))"
pg_dump "$DB_URL" --format=custom --compress=6 --no-owner --no-privileges \
  --snapshot="$SNAPSHOT_ID" --file="$OUT_DUMP"
echo "[pg-dump] pg_dump 完了: $(stat -c %s "$OUT_DUMP") bytes"

# 同じトランザクションで件数を数える。
echo "\\o $OUT_COUNTS" >&"${PSQL[1]}"
echo "$COUNTS_SQL" >&"${PSQL[1]}"
echo "\\o" >&"${PSQL[1]}"
echo "COMMIT;" >&"${PSQL[1]}"
echo "\\q" >&"${PSQL[1]}"
wait "$PSQL_PID"

if [ ! -s "$OUT_COUNTS" ]; then
  echo "件数表の出力が空です" >&2
  exit 1
fi
chmod 600 "$OUT_DUMP" "$OUT_COUNTS"
echo "[pg-dump] 件数表を出力しました（テーブル数・行数は呼び出し側で表示）"
