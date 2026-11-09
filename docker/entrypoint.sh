#!/bin/sh
set -eu

echo "Aguardando o banco de dados do Radar Ódio..."
node scripts/wait-for-db.mjs

if node scripts/check-db.mjs; then
  echo "Estrutura de revisão humana já está pronta."
elif [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  echo "Aplicando as migrações do sistema de revisão..."
  node scripts/migrate.mjs
else
  echo "O banco precisa de migração e RUN_DB_MIGRATIONS=false." >&2
  exit 1
fi

echo "Iniciando o Radar Ódio na porta ${PORT:-3000}..."
exec node server.js
