#!/usr/bin/env bash
# T-XXX step3: 復元テスト。復号済みのダンプを「使い捨ての PostgreSQL 17」に pg_restore し、
# 件数表と突き合わせる。postgres:17 コンテナの中で実行する想定。
#
#   docker exec -e RESTORE_URL=... <container> bash /work/pg-restore-test.sh /work/x.dump /work/x.counts.json
#
# ★安全装置: 復元先（RESTORE_URL）のホストが localhost / 127.0.0.1 以外なら、何もせず即座に中断する。
#   本番の接続文字列を復元先に使うことは絶対に無いようにするための門番。
#   このチェックは pg_restore より前、最初に行う。

set -euo pipefail

DUMP="${1:?ダンプのパス}"
COUNTS="${2:?件数表のパス}"
: "${RESTORE_URL:?環境変数 RESTORE_URL が未設定}"

# --- 安全装置（最初に実行） ---
RESTORE_HOST="$(printf '%s' "$RESTORE_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*$#\2#')"
case "$RESTORE_HOST" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "中断: 復元先ホストが localhost ではありません（host=$RESTORE_HOST）。本番を上書きしないため何もしません。" >&2
    exit 90
    ;;
esac
case "$RESTORE_URL" in
  *rlwy.net*|*railway.internal*|*railway.app*)
    echo "中断: 復元先に Railway のホスト名が含まれています。何もしません。" >&2
    exit 91
    ;;
esac
echo "[restore-test] 復元先ホスト=$RESTORE_HOST（localhost 確認済み）"

# --- 使い捨てDBを作って復元 ---
DBNAME="restoretest_$(date +%s)"
ADMIN_URL="${RESTORE_URL%/*}/postgres"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -X -c "CREATE DATABASE \"$DBNAME\";"
TARGET_URL="${RESTORE_URL%/*}/$DBNAME"
echo "[restore-test] pg_restore 開始 ($(pg_restore --version)) → $DBNAME"
set +e
pg_restore --dbname="$TARGET_URL" --no-owner --no-privileges --exit-on-error --jobs=2 "$DUMP"
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  echo "pg_restore が終了コード $RC で失敗しました" >&2
  exit 1
fi
echo "[restore-test] pg_restore 完了"

# --- 件数の突き合わせ（件数表と同じクエリ） ---
read -r -d '' COUNTS_SQL <<'SQL' || true
SELECT json_build_object(
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
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -A -t -X -c "$COUNTS_SQL" > "${COUNTS}.restored"

EXPECTED_TABLES="$(sed -E 's/.*"tableCount" *: *([0-9]+).*/\1/' "$COUNTS")"
echo "[restore-test] 期待テーブル数=$EXPECTED_TABLES"

# jq はコンテナに無いので、psql 自身に JSON 比較をさせる。
DIFF="$(psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -A -t -X \
  -v expected="$(cat "$COUNTS")" -v actual="$(cat "${COUNTS}.restored")" <<'SQL'
WITH e AS (SELECT key, value::bigint AS cnt FROM json_each_text((:'expected')::json -> 'tables')),
     a AS (SELECT key, value::bigint AS cnt FROM json_each_text((:'actual')::json -> 'tables'))
SELECT coalesce(e.key, a.key) || ': expected=' || coalesce(e.cnt::text, '(none)') || ' actual=' || coalesce(a.cnt::text, '(none)')
FROM e FULL OUTER JOIN a ON e.key = a.key
WHERE e.cnt IS DISTINCT FROM a.cnt
ORDER BY 1;
SQL
)"

# psql の変数展開（:'actual'）は -c では効かないので、標準入力で渡す。
TOTAL_ROWS="$(psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -A -t -X -v actual="$(cat "${COUNTS}.restored")" <<'SQL'
SELECT sum(value::bigint) FROM json_each_text((:'actual')::json -> 'tables');
SQL
)"
ACTUAL_TABLES="$(sed -E 's/.*"tableCount" *: *([0-9]+).*/\1/' "${COUNTS}.restored")"

if [ -n "$DIFF" ]; then
  echo "件数が一致しません:" >&2
  echo "$DIFF" >&2
  exit 2
fi
echo "[restore-test] 件数一致: テーブル $ACTUAL_TABLES 件・合計 $TOTAL_ROWS 行"
# コンテナ内なので GITHUB_OUTPUT には直接書けない。結果ファイルに残し、ワークフロー側で読む。
printf 'tables=%s\nrows=%s\n' "$ACTUAL_TABLES" "$TOTAL_ROWS" > "${COUNTS}.result"

# 使い捨てDBを落とす（コンテナごと消えるが念のため）
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -X -c "DROP DATABASE \"$DBNAME\";"
