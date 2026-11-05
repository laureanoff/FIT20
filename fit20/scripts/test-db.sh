#!/usr/bin/env bash
# Aplica las migraciones sobre un Postgres local descartable (con auth/storage simulados)
# y corre las pruebas de RLS, versionado e idempotencia.
# Requiere: PostgreSQL 15+ instalado localmente (initdb, pg_ctl, psql).
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(dirname "$(command -v initdb || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
TMP="$(mktemp -d)"
PORT="${PORT:-54329}"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -p $PORT -c listen_addresses=" -l "$TMP/log" start >/dev/null

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c 'create database fit20test'
"${PSQL[@]}" -d fit20test -f tests/db/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -d fit20test -f "$f" >/dev/null
done
"${PSQL[@]}" -d fit20test -f tests/db/rls.test.sql
