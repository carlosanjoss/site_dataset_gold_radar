#!/bin/sh
set -eu

DUMP_FILE="/backups/radar_odio.dump"
SQL_FILE="/backups/radar_odio.sql.gz"

if [ -f "$DUMP_FILE" ]; then
  echo "Restaurando o backup completo do Radar Ódio..."
  pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$DUMP_FILE"
  echo "Backup restaurado com sucesso."
elif [ -f "$SQL_FILE" ]; then
  echo "Restaurando o backup SQL do Radar Ódio..."
  gunzip -c "$SQL_FILE" | psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --set ON_ERROR_STOP=1
  echo "Backup restaurado com sucesso."
else
  echo "ERRO: nenhum backup foi encontrado em /backups." >&2
  echo "Crie backups/radar_odio.dump antes de iniciar o ambiente na VM." >&2
  exit 1
fi

touch /var/lib/postgresql/restore-complete
