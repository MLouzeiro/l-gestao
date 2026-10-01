import fs from "fs";
import path from "path";
import {
  insertKnowledge,
  computeEmbedding,
  closeDb,
} from "./rag-db";

const CATEGORY_LABELS = ["bug", "decisao_arquitetura", "padrao_time", "nao_funcionou"] as const;
type Category = (typeof CATEGORY_LABELS)[number];

interface Extract {
  category: Category;
  title: string;
  body: string;
  agent: string;
}

function extractLearnings(docPath: string, content: string): Extract[] {
  const agent = path.basename(docPath).replace(/\.md$/, "");
  const extracts: Extract[] = [];

  const lower = content.toLowerCase();

  // Detect category by content analysis
  const hasBugContext = /erro|bug|falha|quebrou|não funcionou|exception|crash|stack.*trace|500|404|401|prisma.*error/i.test(lower);
  const hasDecision = /decidimos|escolhemos|optamos|motivo|justificativa|por que.*escolhemos|trade.?off/i.test(lower);
  const hasPattern = /padrão|convenção|sempre.*fazer|nunca.*fazer|regra|boas práticas|guideline|codigo.*estilo/i.test(lower);
  const hasNotWorked = /tentamos|experimentamos|testamos.*falhou|não.*funcionou|problema.*com|issue.*com/i.test(lower);

  if (hasBugContext) {
    const match = content.match(/(?:erro|bug|falha)[^.]*\./i);
    extracts.push({
      category: "bug",
      title: `Bug: ${(match?.[0] || "Erro identificado").slice(0, 80)}`,
      body: content.slice(0, 500),
      agent,
    });
  }

  if (hasDecision) {
    const match = content.match(/(?:decidimos|escolhemos|optamos)[^.]*\./i);
    extracts.push({
      category: "decisao_arquitetura",
      title: `Decisão: ${(match?.[0] || "Decisão arquitetural").slice(0, 80)}`,
      body: content.slice(0, 500),
      agent,
    });
  }

  if (hasPattern) {
    const match = content.match(/(?:padrão|convenção|sempre.*fazer|nunca.*fazer)[^.]*\./i);
    extracts.push({
      category: "padrao_time",
      title: `Padrão: ${(match?.[0] || "Padrão do time").slice(0, 80)}`,
      body: content.slice(0, 500),
      agent,
    });
  }

  if (hasNotWorked) {
    const match = content.match(/(?:tentamos|experimentamos|testamos.*falhou|não.*funcionou)[^.]*\./i);
    extracts.push({
      category: "nao_funcionou",
      title: `Não funcionou: ${(match?.[0] || "Abordagem que não funcionou").slice(0, 80)}`,
      body: content.slice(0, 500),
      agent,
    });
  }

  // Fallback: if nothing matched, create a generic entry
  if (extracts.length === 0) {
    extracts.push({
      category: "padrao_time",
      title: `Aprendizado: ${content.split("\n")[0]?.slice(0, 80) || "Aprendizado geral"}`,
      body: content.slice(0, 500),
      agent,
    });
  }

  return extracts;
}

async function main() {
  const args = process.argv.slice(2);
  const targetPath = args[0];

  if (!targetPath) {
    console.error("Uso: npx ts-node .claude/scripts/summarize.ts <caminho-do-arquivo.md>");
    console.error("  <caminho> pode ser um arquivo .md individual ou um diretório");
    process.exit(1);
  }

  const resolvedPath = path.resolve(targetPath);

  let files: string[];
  if (fs.statSync(resolvedPath).isDirectory()) {
    files = fs.readdirSync(resolvedPath)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(resolvedPath, f));
  } else {
    files = [resolvedPath];
  }

  let totalChunks = 0;
  for (const file of files) {
    console.log(`\n📄 Processando: ${path.relative(process.cwd(), file)}`);
    const content = fs.readFileSync(file, "utf-8");
    const extracts = extractLearnings(file, content);

    for (const ext of extracts) {
      const embedding = computeEmbedding(`${ext.title}\n${ext.body}`);
      const result = insertKnowledge(file, `${ext.title}\n${ext.body}`, embedding, ext.category, ext.agent);
      totalChunks++;
      console.log(`  ✅ [${ext.category.toUpperCase()}] ${ext.title.slice(0, 60)} → id=${result.lastInsertRowid}`);
    }
  }

  console.log(`\n✨ ${totalChunks} chunks inseridos no RAG`);
  closeDb();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
