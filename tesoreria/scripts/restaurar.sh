#!/usr/bin/env bash
#
# Restaura un respaldo en una base de prueba, para comprobar que sirve.
#
#   bash scripts/restaurar.sh respaldos/tesoreria-AAAAMMDD-HHMM.dump
#   bash scripts/restaurar.sh respaldos/tesoreria-AAAAMMDD-HHMM.dump masada_tesoreria_copia
#
# Nunca restaura sobre la base de trabajo: hay que darle un nombre distinto, y por
# omisión usa uno con sufijo _restauro. Así probar el respaldo no puede destruir
# los datos buenos.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "uso: bash scripts/restaurar.sh <archivo.dump> [nombre_de_base]" >&2
  exit 1
fi

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: falta DATABASE_URL." >&2
  exit 1
fi

BASE_TRABAJO="$(basename "${DATABASE_URL%%\?*}")"
DESTINO="${2:-${BASE_TRABAJO}_restauro}"

if [ "$DESTINO" = "$BASE_TRABAJO" ]; then
  echo "error: no se restaura sobre la base de trabajo ($BASE_TRABAJO)." >&2
  exit 1
fi

BASE_ADMIN="${DATABASE_URL%/*}/postgres"

echo "==> Restaurando $DUMP en la base $DESTINO"
psql --dbname="$BASE_ADMIN" -v ON_ERROR_STOP=1 -c "drop database if exists \"$DESTINO\""
psql --dbname="$BASE_ADMIN" -v ON_ERROR_STOP=1 -c "create database \"$DESTINO\""

URL_DESTINO="${DATABASE_URL%/*}/$DESTINO"
pg_restore --dbname="$URL_DESTINO" --no-owner --no-privileges "$DUMP"

echo ""
echo "==> Comprobación rápida"
psql --dbname="$URL_DESTINO" -c "
  select (select count(*) from hermano) as hermanos,
         (select count(*) from movimiento) as movimientos,
         (select count(*) from egreso) as egresos,
         (select count(*) from corte_mensual where estado = 'cerrado') as cortes_cerrados,
         (select coalesce(max(version), 'ninguna') from schema_migracion) as ultima_migracion"

echo ""
echo "Si esas cifras se parecen a las de la base de trabajo, el respaldo sirve."
echo "Para borrar la copia de prueba:"
echo "  psql -d postgres -c 'drop database \"$DESTINO\"'"
