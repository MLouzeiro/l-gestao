import type { Plugin, Part } from "@opencode-ai/plugin";
import { createRequire } from "module";
import path from "path";
import fs from "fs";

type AgentCategory = "backend" | "frontend" | "infra";

const AGENT_CATEGORY: Record<string, AgentCategory> = {
  "backend-auth": "backend",
  "backend-crud": "backend",
  "backend-metrics": "backend",
  "frontend-admin": "frontend",
  "frontend-auth": "frontend",
  "frontend-core": "frontend",
  "frontend-kanban": "frontend",
  "infra": "infra",
};

const BLOCKED_PATHS: Record<AgentCategory, string[]> = {
  backend: [
    "src/components/",
    "src/app/board/",
    "src/app/dashboard/",
    "src/app/vendedores/",
    "src/app/login/",
  ],
  frontend: ["src/app/api/", "prisma/", ".env"],
  infra: ["src/app/api/", "src/components/", "src/hooks/", "src/types/"],
};

const BLOCKED_CMDS: Record<AgentCategory, RegExp[]> = {
  backend: [/git push/i, /vercel deploy/i, /npm run dev/i, /prisma studio/i],
  frontend: [
    /git push/i,
    /vercel deploy/i,
    /npx prisma migrate/i,
    /prisma studio/i,
  ],
  infra: [/git push/i],
};

const sessionAgent = new Map<string, AgentCategory>();

function computeEmbedding(text: string): number[] {
  const dim = 128;
  const vector = new Array(dim).fill(0);
  const cleaned = text.toLowerCase().replace(/[^a-z0-9áàâãéèêíìóòôõúùûç\s]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  for (const word of words) {
    for (let i = 0; i < word.length - 1; i++) {
      const bigram = word.slice(i, i + 2);
      let hash = 0;
      for (let j = 0; j < bigram.length; j++) {
        hash = (hash * 31 + bigram.charCodeAt(j)) % dim;
      }
      vector[hash] += 1;
    }
  }
  const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dim; i++) vector[i] /= magnitude;
  }
  return vector;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function getRagDb(projectDir: string) {
  try {
    const require_ = createRequire(path.join(projectDir, "package.json"));
    const Database = require_("better-sqlite3");
    const dbPath = path.join(projectDir, ".claude", "rag.db");
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    return db;
  } catch {
    return null;
  }
}

function searchRag(projectDir: string, queryEmbedding: number[], agent?: string): string[] {
  const db = getRagDb(projectDir);
  if (!db) return [];

  try {
    const rows = agent
      ? db.prepare("SELECT * FROM knowledge WHERE agent = ? ORDER BY created_at DESC LIMIT 20").all(agent)
      : db.prepare("SELECT * FROM knowledge ORDER BY created_at DESC LIMIT 20").all();

    const scored = (rows as any[])
      .map((row: any) => ({
        content: row.content as string,
        category: row.category as string,
        agent: row.agent as string,
        similarity: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    return scored.map(
      (r) => `[RAG:${r.category}/${r.agent}] ${r.content.slice(0, 500)}`
    );
  } finally {
    db.close();
  }
}

const plugin: Plugin = async (input) => {
  const projectDir = input.directory;

  return {
    "chat.params": async (input) => {
      const cat = AGENT_CATEGORY[input.agent];
      if (cat) sessionAgent.set(input.sessionID, cat);
    },

    "tool.execute.before": async (input, output) => {
      const cat = sessionAgent.get(input.sessionID);
      if (!cat || (input.tool !== "Write" && input.tool !== "Edit")) return;

      const fp: string | undefined = output.args?.filePath;
      if (!fp) return;

      for (const pattern of BLOCKED_PATHS[cat]) {
        if (fp.startsWith(pattern) || fp.includes(pattern)) {
          throw new Error(
            `[BLOCKED] Agent "${cat}" cannot write/edit "${fp}". ` +
              `Scope violation: path "${pattern}" is outside this agent's domain.`
          );
        }
      }
    },

    "tool.execute.after": async (input) => {
      const cat = sessionAgent.get(input.sessionID);
      if (!cat || (input.tool !== "Write" && input.tool !== "Edit")) return;

      console.log(
        `[HOOK] ${cat} agent edited a file — consider verifying with \`npm test\`.`
      );
    },

    "command.execute.before": async (input, output) => {
      const cat = sessionAgent.get(input.sessionID);
      if (!cat) return;

      for (const re of BLOCKED_CMDS[cat]) {
        if (re.test(input.command)) {
          output.parts = [
            {
              type: "text",
              text: `[BLOCKED] Agent "${cat}" cannot run: ${input.command}. This command is outside the agent's scope.`,
            } as Part,
          ];
        }
      }
    },

    event: async (input) => {
      const ev = input.event;
      if (ev.type === "message.updated") {
        const msg = ev.properties.info;
        if (msg.role === "assistant" && msg.finish) {
          const cat = sessionAgent.get(msg.sessionID);
          if (cat) {
            console.log(
              `[RAG] Agent ${cat} completed message in ${msg.sessionID.slice(0, 8)} — ${msg.tokens.input + msg.tokens.output}tokens, cost=$${msg.cost.toFixed(4)}`
            );
          }
        }
      }
      if (ev.type === "session.created") {
        console.log(`[RAG] Session started: ${ev.properties.info.title || ev.properties.info.id.slice(0, 8)}`);
      }
    },

    "experimental.session.compacting": async (input, output) => {
      const cat = sessionAgent.get(input.sessionID);
      if (!cat) return;

      const queryEmb = computeEmbedding(
        `recent work in ${cat} category: agents, leads, metrics, sales pipeline`
      );
      const contexts = searchRag(projectDir, queryEmb, cat);

      if (contexts.length > 0) {
        output.context = output.context || [];
        output.context.push(
          `--- Knowledge Base (RAG) relevante para ${cat} ---`,
          ...contexts,
          "---"
        );
      }
    },
  };
};

export default plugin;
