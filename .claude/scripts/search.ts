import { searchSimilar, computeEmbedding, closeDb } from "./rag-db";

async function main() {
  const args = process.argv.slice(2);
  const query = args.join(" ");

  if (!query) {
    console.error("Uso: npx ts-node .claude/scripts/search.ts <query>");
    process.exit(1);
  }

  const queryEmb = computeEmbedding(query);
  const results = searchSimilar(queryEmb, undefined, 5);

  if (results.length === 0) {
    console.log("Nenhum resultado encontrado.");
    closeDb();
    return;
  }

  console.log(`🔍 Resultados para: "${query}"\n`);
  for (let i = 0; i < results.length; i++) {
    const { row, similarity } = results[i];
    console.log(`${"=".repeat(60)}`);
    console.log(`[${i + 1}] ${(similarity * 100).toFixed(1)}% match`);
    console.log(`    Categoria: ${row.category}`);
    console.log(`    Agente:    ${row.agent}`);
    console.log(`    Fonte:     ${row.path}`);
    console.log(`    Criado:    ${row.created_at}`);
    console.log(`    Conteúdo:  ${row.content.slice(0, 300).replace(/\n/g, " ")}...`);
    console.log();
  }

  closeDb();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
