import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrações DDL rodam como dono (admin); a aplicação usa DATABASE_URL.
    url: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
