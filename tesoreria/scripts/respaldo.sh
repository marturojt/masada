#!/usr/bin/env bash
#
# Respaldo de la tesorería: base de datos y comprobantes.
#
# Los dos van juntos y con la misma marca de tiempo: una base sin comprobantes es
# un libro sin evidencia, y unos comprobantes sin base son archivos sueltos que
# nadie sabe a qué movimiento pertenecen.
#
#   bash scripts/respaldo.sh
#
# Un respaldo que nunca se ha restaurado no es un respaldo. Para probarlo:
#   bash scripts/restaurar.sh respaldos/tesoreria-AAAAMMDD-HHMM.dump

set -euo pipefail
umask 077

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: falta DATABASE_URL. Copia .env.example a .env y ajústalo." >&2
  exit 1
fi

COMPROBANTES="${COMPROBANTES_DIR:-$RAIZ/comprobantes}"
DESTINO="$RAIZ/respaldos"
MARCA="$(date +%Y%m%d-%H%M)"
DIAS_A_CONSERVAR=14

mkdir -p "$DESTINO"

DUMP="$DESTINO/tesoreria-$MARCA.dump"
TAR="$DESTINO/comprobantes-$MARCA.tgz"
MANIFIESTO="$DESTINO/respaldo-$MARCA.sha256"

echo "==> 1/4  Base de datos"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$DUMP"

echo "==> 2/4  Comprobantes"
if [ -d "$COMPROBANTES" ]; then
  tar -czf "$TAR" -C "$COMPROBANTES" .
else
  echo "    aviso: no existe $COMPROBANTES, se omite"
  TAR=""
fi

echo "==> 3/4  Manifiesto"
{
  shasum -a 256 "$DUMP"
  [ -n "$TAR" ] && shasum -a 256 "$TAR"
} > "$MANIFIESTO"

echo "==> 4/4  Rotación (se conservan los últimos $DIAS_A_CONSERVAR y el primero de cada mes)"
# shellcheck disable=SC2012
ls -1t "$DESTINO"/tesoreria-*.dump 2>/dev/null | tail -n +$((DIAS_A_CONSERVAR + 1)) | while read -r viejo; do
  marca_vieja="$(basename "$viejo" .dump | sed 's/^tesoreria-//')"
  dia="${marca_vieja:6:2}"
  if [ "$dia" = "01" ]; then
    continue   # el primero de cada mes se queda
  fi
  rm -f "$viejo" "$DESTINO/comprobantes-$marca_vieja.tgz" \
        "$DESTINO/respaldo-$marca_vieja.sha256"
  echo "    borrado $(basename "$viejo")"
done

echo ""
echo "Listo:"
ls -lh "$DUMP" ${TAR:+"$TAR"} "$MANIFIESTO" | awk '{print "  " $5 "\t" $9}'
echo ""
echo "Los respaldos viven en $DESTINO y NO se versionan."
echo "Guarda una copia fuera de esta máquina: un respaldo que solo vive aquí no"
echo "sobrevive al incidente que lo hace necesario."
