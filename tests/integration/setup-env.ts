import "dotenv/config";

// Roda nos workers do Jest ANTES dos testes: aponta o pool (db/client) para o
// banco de teste isolado (estoque_test), nunca para o banco de desenvolvimento.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
