/** Catalog access + keyword search over the demo marketplace. */
import type { Product } from "./domain";
import { MERCHANTS, PRODUCTS } from "./catalog-seed";
import type { CatalogView } from "./policy";

export const catalog: CatalogView = {
  product: (id) => PRODUCTS.find((p) => p.id === id),
  merchant: (id) => MERCHANTS.find((m) => m.id === id),
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");

export function searchCatalog(query: string, category = ""): Product[] {
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 1);
  return PRODUCTS.filter((p) => !category || p.category === category)
    .map((p) => {
      const hay = norm(`${p.name} ${p.category}`);
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { p, score };
    })
    .filter((x) => terms.length === 0 || x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, 8)
    .map((x) => x.p);
}
