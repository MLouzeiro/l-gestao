import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

// Suíte de integração: banco Postgres real (estoque_test, recriado no
// globalSetup) — valida movimentações, cache e RLS de verdade.
// Uso: npm run test:integration  (exige Docker local)
const integrationConfig: Config = {
  displayName: "integration",
  testEnvironment: "node",
  globalSetup: "<rootDir>/tests/integration/global-setup.ts",
  setupFiles: ["<rootDir>/tests/integration/setup-env.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
};

export default createJestConfig(integrationConfig);
