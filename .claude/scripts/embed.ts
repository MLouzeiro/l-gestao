import fs from "fs";
import path from "path";
import {
  insertKnowledge,
  computeEmbedding,
  getAllKnowledge,
  closeDb,
} from "./rag-db";

function chunkText(text: string, sourcePath: string, category: string, agent: string, maxTokens = 250) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: { text: string; sourcePath: string; category: string; agent: string }[] = [];
  let current = "";

  for (const sentence of sentences) {
    const roughTokens = (current + " " + sentence).split(/\s+/).length;
    if (roughTokens > maxTokens && current.length > 0) {
      chunks.push({ text: current.trim(), sourcePath, category, agent });
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }

  if (current.trim()) chunks.push({ text: current.trim(), sourcePath, category, agent });
  return chunks.length > 0 ? chunks : [{ text: text.trim(), sourcePath, category, agent }];
}

function detectCategory(content: string): string {
  const lower = content.toLowerCase();
  if (/erro|bug|falha|quebrou|não funcionou|exception|crash|500|404|401/.test(lower)) return "bug";
  if (/decidimos|escolhemos|optamos|motivo|trade.?off/.test(lower)) return "decisao_arquitetura";
  if (/padrão|convenção|sempre.*fazer|nunca.*fazer|regra|guideline/.test(lower)) return "padrao_time";
  if (/tentamos|experimentamos|não.*funcionou|problema.*com/.test(lower)) return "nao_funcionou";
  return "padrao_time";
}

async function main() {
  const args = process.argv.slice(2);
  const sourceDir = args[0] || path.resolve(__dirname, "..", "knowledge");

  const files: string[] = [];
  if (fs.statSync(sourceDir).isDirectory()) {
    for (const f of fs.readdirSync(sourceDir)) {
      if (f.endsWith(".md")) files.push(path.join(sourceDir, f));
    }
  } else {
    files.push(sourceDir);
  }

  // Clear existing entries for files being re-processed
  // (simple approach: delete and re-insert)
  const existing = getAllKnowledge();
  const existingPaths = new Set(files.map((f) => path.resolve(f)));
  const toRemove = existing.filter((r) => existingPaths.has(r.path));
  console.log(`🗑️  ${toRemove.length} entries to refresh`);

  let total = 0;
  for (const file of files) {
    console.log(`📄 ${path.relative(process.cwd(), file)}`);
    const content = fs.readFileSync(file, "utf-8");
    const category = detectCategory(content);
    const agent = path.basename(file).replace(/\.md$/, "");
    const chunks = chunkText(content, path.resolve(file), category, agent);

    for (const chunk of chunks) {
      const embedding = computeEmbedding(chunk.text);
      const result = insertKnowledge(
        chunk.sourcePath,
        chunk.text,
        embedding,
        chunk.category as any,
        chunk.agent
      );
      total++;
    }
  }

  console.log(`\n✨ ${total} chunks embedded and stored`);
  closeDb();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
