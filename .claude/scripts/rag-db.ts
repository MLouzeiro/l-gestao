import Database from "better-sqlite3";
import path from "path";
import { computeEmbedding, cosineSimilarity } from "./embedding";

const RAG_DB_PATH = path.resolve(__dirname, "..", "rag.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(RAG_DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN (
        'bug', 'decisao_arquitetura', 'padrao_time', 'nao_funcionou'
      )),
      agent TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
    CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge(agent);
    CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge(created_at);
  `);
}

export interface KnowledgeRow {
  id: number;
  path: string;
  content: string;
  embedding: string;
  category: "bug" | "decisao_arquitetura" | "padrao_time" | "nao_funcionou";
  agent: string;
  created_at: string;
}

export function insertKnowledge(
  path: string,
  content: string,
  embedding: number[],
  category: KnowledgeRow["category"],
  agent: string
) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO knowledge (path, content, embedding, category, agent)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(path, content, JSON.stringify(embedding), category, agent);
}

export function searchSimilar(
  queryEmbedding: number[],
  agent?: string,
  limit: number = 3
): { row: KnowledgeRow; similarity: number }[] {
  const d = getDb();
  const rows = agent
    ? d.prepare("SELECT * FROM knowledge WHERE agent = ? ORDER BY created_at DESC").all(agent) as KnowledgeRow[]
    : d.prepare("SELECT * FROM knowledge ORDER BY created_at DESC").all() as KnowledgeRow[];

  const scored = rows
    .map((row) => ({
      row,
      similarity: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding)),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

export function getAllKnowledge(agent?: string): KnowledgeRow[] {
  const d = getDb();
  return agent
    ? d.prepare("SELECT * FROM knowledge WHERE agent = ? ORDER BY created_at DESC").all(agent) as KnowledgeRow[]
    : d.prepare("SELECT * FROM knowledge ORDER BY created_at DESC").all() as KnowledgeRow[];
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export { computeEmbedding, cosineSimilarity };
