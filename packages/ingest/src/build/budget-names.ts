import { nameKey } from './aggregation-search.js';

interface MinistryIdentity {
  id: string;
  art: number;
  name: string;
}
interface MunicipalityIdentity {
  id: string;
  name: string;
  lawName?: string;
  region: string;
}

/** The 2027 bill inserts the anti-corruption commission at article 32. */
export function budget2027Codes(items: MinistryIdentity[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.art + (item.art >= 32 ? 1 : 0), item.id]));
}

/** Resolve source spellings to registry codes before choosing a display name. */
export function nameBudget2027(
  budget: Record<string, any>,
  ministries: MinistryIdentity[],
  municipalities: MunicipalityIdentity[],
): void {
  const codes = budget2027Codes(ministries);
  const ministryNames = new Map(ministries.map((item) => [item.id, item.name]));
  // Full municipal name already used in the municipal transfers name list.
  const municipalNames = new Map(
    municipalities.map((item) => [item.id, item.id === 'SOF46' ? 'Столична община' : item.name]),
  );
  for (const variant of Object.values(budget.budgets) as Record<string, any>[])
    for (const [article, item] of Object.entries(variant)) {
      if (article === '1') continue; // State budget, not a first-level entity.
      const name = ministryNames.get(codes[article]!);
      if (name) item.name = name;
      else
        item.nameNote =
          'Няма запис в списъка на първостепенните разпоредители за този член; запазено е името от проекта.';
    }
  for (const rows of Object.values(budget.municipal) as any[][])
    for (const row of rows) {
      let matches = municipalities.filter((item) =>
        [item.name, item.lawName ?? ''].some((name) => nameKey(name) === nameKey(row.name)),
      );
      if (matches.length > 1)
        matches = matches.filter(
          (item) => nameKey(item.region) === nameKey(row.region.replace(/^ОБЛАСТ\s+/u, '')),
        );
      if (matches.length > 1) throw new Error('Ambiguous municipality identity: ' + row.name);
      const name = matches[0] && municipalNames.get(matches[0].id);
      if (name) row.name = name;
      else row.nameNote = 'Няма запис в регистъра на общините; запазено е името от проекта.';
    }
}
