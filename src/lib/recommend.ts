export function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }

  return dot;
}

export function getRecommendations(
  sourceProduct: any,
  catalog: any[],
  limit = 20
) {
  const scored = catalog
    .filter(
      (item) =>
        item.item_code !== sourceProduct.item_code &&
        item.category === sourceProduct.category &&
        item.subcategory === sourceProduct.subcategory
    )
    .map((item) => ({
      ...item,
      score: cosineSimilarity(
        sourceProduct.embedding,
        item.embedding
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const unique = [];
  for (const item of scored) {
    if (!seen.has(item.item_code)) {
      seen.add(item.item_code);
      unique.push(item);
      if (unique.length === limit) break;
    }
  }

  return unique;
}