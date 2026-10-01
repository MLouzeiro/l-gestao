export function computeEmbedding(text: string): number[] {
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

export function cosineSimilarity(a: number[], b: number[]): number {
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
