import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";

// Recria o banco estoque_test do zero e aplica as migrations antes da suíte.
// (Rodar com o Docker local de pé: docker compose up -d)
export default async function globalSetup(): Promise<void> {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error("DATABASE_URL_TEST ausente no .env");
  }
  // Migrations rodam como dono das tabelas (usuário estoque)
  const adminUrl = testUrl.replace("estoque_app:", "estoque:");
  // Conectar em outro banco para poder dropar o estoque_test
  const serverUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

  const client = new Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query("DROP DATABASE IF EXISTS estoque_test WITH (FORCE)");
    await client.query("CREATE DATABASE estoque_test");
  } finally {
    await client.end();
  }

  execSync("npx drizzle-kit migrate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL_ADMIN: adminUrl },
  });
}
