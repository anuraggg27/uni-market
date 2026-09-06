#!/usr/bin/env bash
set -Eeuo pipefail

# Remote production dumps require the system trust store, even though this
# isolated fixture test connects only to loopback PostgreSQL.
test -s /etc/ssl/certs/ca-certificates.crt

# Run only inside the disposable backup-tool container as the postgres user.
smoke_database_dir="$(mktemp -d /tmp/uni-market-restore-smoke.XXXXXX)"
initdb -D "$smoke_database_dir" --no-locale -U postgres --auth=trust >/dev/null
pg_ctl -D "$smoke_database_dir" -o '-h 127.0.0.1 -p 5432' -w start >/dev/null
smoke_roundtrip_dir=''
cleanup_smoke_databases() {
  if [[ -n "$smoke_roundtrip_dir" ]]; then
    pg_ctl -D "$smoke_roundtrip_dir" -m immediate -w stop >/dev/null || true
  fi
  pg_ctl -D "$smoke_database_dir" -m immediate -w stop >/dev/null || true
}
trap cleanup_smoke_databases EXIT
if [[ "${1:-}" == '--r2' ]]; then
  test "${R2_BACKUP_LIVE_TEST:-}" = 'true'
  smoke_roundtrip_dir="$(mktemp -d /tmp/uni-market-r2-restore-smoke.XXXXXX)"
  initdb -D "$smoke_roundtrip_dir" --no-locale -U postgres --auth=trust >/dev/null
  pg_ctl -D "$smoke_roundtrip_dir" -o '-h 127.0.0.1 -p 5433' -w start >/dev/null
fi
node tests/operations/backup-smoke.mjs "$@"
