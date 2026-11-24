import {
  readExecutionLawXml,
  verifyParliamentCells,
} from '../../production/annual-word-validation.js';
import { zipMember } from '../../build/annual-lineage.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import {
  readParliamentDocument,
  PARLIAMENT_DOCUMENT,
  PARLIAMENT_SHA256,
} from './parliament-document.js';
import { extractParliamentForecast } from './parliament-forecast.js';
import { extractParliamentBill } from './parliament-bill.js';
import {
  extractAnnual2027,
  readAnnualRegistration,
  sha256,
  type AnnualRegistration,
} from './index.js';
import { buildWave13a, type Wave13aOutputs } from '../../build/wave13a.js';
import { forecastIdentities } from '../../validate/budget-2027.js';
import { Check } from '../../validate/checks.js';

const root = resolve(import.meta.dirname, '../../../../..');
let document: ReturnType<typeof readParliamentDocument>;
let source: Record<string, any>, bill: Record<string, any>, forecast: Record<string, any>;
let outputs: Wave13aOutputs, bytes: Buffer, registration: AnnualRegistration, acquisition: Buffer;
beforeAll(async () => {
  bytes = readFileSync(resolve(root, PARLIAMENT_DOCUMENT));
  document = readParliamentDocument(bytes);
  source = {
    archive: PARLIAMENT_DOCUMENT,
    sha256: sha256(bytes),
    member: 'word/document.xml',
    memberSha256: document.source.memberSha256,
    format: 'docx',
    publication: '2026-11-16',
  };
  bill = extractParliamentBill(document, source);
  forecast = extractParliamentForecast(document, source);
  const legacy = Object.fromEntries(
    ['outlook', 'revenue', 'expenditure', 'law'].map((k) => [
      k,
      JSON.parse(readFileSync(resolve(root, `data/release/${k}.json`), 'utf8')),
    ]),
  );
  outputs = buildWave13a({
    forecast,
    bill,
    archives: { forecast: bytes, bill: bytes },
    legacy,
    buildDate: '2026-11-24',
  } as any);
  registration = await readAnnualRegistration(
    resolve(root, 'data/sources.yaml'),
    resolve(root, 'data/originals.sha256'),
  );
  acquisition = readFileSync(resolve(root, registration.acquisition));
}, 30_000);

it('authenticates the official parliamentary original and complete source inventories', () => {
  expect(sha256(bytes)).toBe(PARLIAMENT_SHA256);
  expect(document.tables).toHaveLength(46);
  expect(document.embedded).toHaveLength(4);
  expect(Object.keys(bill.bill)).toHaveLength(48);
  expect(Object.keys(bill.billMc)).toEqual(['1', '2']);
  expect(bill.municipal.art52.rows).toHaveLength(265);
  expect(bill.municipal.art53.rows).toHaveLength(265);
  expect(Object.keys(forecast.tables)).toHaveLength(35);
  expect(Object.values(forecast.tables).reduce((n: number, t: any) => n + t.rows.length, 0)).toBe(
    609,
  );
});

it('distinguishes the billion-euro commitment revision from unchanged annual expenditure', () => {
  expect(bill.bill['23'].headline.exp).toBe(1210251.6);
  expect(bill.bill['23'].commitments).toEqual({ entered: 2510993.9, new: 1136360 });
  const old = JSON.parse(
    readFileSync(
      resolve(
        root,
        'packages/ingest/test/fixtures/fiscal/inputs/data/inputs/budget_bill_2027.json',
      ),
      'utf8',
    ),
  );
  expect(old.bill['23'].commitments.entered).toBe(1510993.9);
});

it('preserves the 225 actual project rows and explains the removed original row by identity', () => {
  const old = JSON.parse(
    readFileSync(
      resolve(
        root,
        'packages/ingest/test/fixtures/fiscal/inputs/data/inputs/budget_bill_2027.json',
      ),
      'utf8',
    ),
  );
  const ids = new Set(bill.projects.rows.map((r: any) => r.id));
  expect(
    old.projects.rows
      .filter((r: any) => !ids.has(r.id))
      .map((r: any) => ({ id: r.id, values: r.values })),
  ).toEqual([{ id: 'NP-25.001-0169', values: [520, 520, 520] }]);
  expect(document.paragraphs.join('\n')).not.toContain('NP-25.001-0169');
  expect(bill.projects.rows.at(-1).n).toBe(225);
  expect(Object.values(bill.bill).every((b: any) => b.pages.length === 0)).toBe(true);
  expect(bill.projects.rows.find((r: any) => r.id === 'NP-25.001-0016').values).toEqual([
    81681.3, 392572.9, 401012.2,
  ]);
});

it('checks source arithmetic and revised social-policy and education figures', () => {
  const check = new Check('PARLIAMENT');
  forecastIdentities(check, forecast.tables);
  expect(check.problems).toEqual([]);
  expect(forecast.tables.II_8.rows[6].values).toEqual([-128, null, null]);
  expect(forecast.tables.II_8.rows.at(-1).values).toEqual([24.7, null, null]);
  expect(outputs['expenditure.json'].byPeriod['2027.draft'].functions[2].cell.value).toBe(5582.6);
  expect(outputs['expenditure.json'].byPeriod['2028.forecast'].functions[2].cell.value).toBe(
    5670.5,
  );
  expect(outputs['expenditure.json'].byPeriod['2029.forecast'].functions[2].cell.value).toBe(5619);
});

it('keeps a printed blank distinct from the revenue calculated using the printed balance', () => {
  expect(bill.bill['5'].headline.rev).toBeNull();
  const row = outputs['budget2027.json'].budgets.bill['5'];
  expect(row.rows.some((r: any) => r.section === 'I')).toBe(false);
  expect(row.derivedRevenue.value).toBe(0);
  expect(row.derivedRevenueNote).toContain('празна');
  const index = outputs['budget2027-provenance.json'].entries;
  expect(index[row.derivedRevenue.provenance].operation).toBe('subtract');
  expect(index[row.derivedRevenueBasis.provenance].operands).toHaveLength(2);
});

it('publishes the new vintage and physical Word/EMF addresses without invented page numbers', () => {
  expect(outputs['budget2027.json'].publication).toBe('2026-11-16');
  expect(outputs['outlook.json'].byPeriod['2027.draft'].publication).toBe('2026-11-16');
  const entries = Object.values(outputs['budget2027-provenance.json'].entries) as any[];
  expect(entries.every((e) => e.operands || e.location)).toBe(true);
  expect(entries.every((e) => e.page === undefined)).toBe(true);
});

it('rejects corrupted original bytes before extracting them', () => {
  const bad = Buffer.from(bytes);
  bad[200] = bad[200]! ^ 1;
  expect(() =>
    extractAnnual2027({ registration, archive: bad, acquisition, buildDate: '2026-11-24' }),
  ).toThrow('Archive checksum mismatch');
});

it('rejects missing project rows rather than silently shrinking the published inventory', () => {
  const bad = structuredClone(document);
  bad.tables[11]!.rows.pop();
  expect(() => extractParliamentBill(bad, source)).toThrow('project inventory');
});

it('rejects changed physical forecast labels and year headers', () => {
  const bad = structuredClone(document);
  bad.tables[16]!.rows[3]![0]!.text = 'Неизвестен ред';
  expect(() => extractParliamentForecast(bad, source)).toThrow('row identity');
  const year = structuredClone(document);
  for (const c of year.tables[16]!.rows[0]!) c.text = c.text.replaceAll('2027', '2030');
  expect(() => extractParliamentForecast(year, source)).toThrow('printed year');
});

it('independently re-reads every published source cell', () => {
  const entries = outputs['budget2027-provenance.json'].entries;
  expect(verifyParliamentCells(bytes, entries)).toBe(6715);
});
it('rejects a changed printed value against its original physical cell', () => {
  const bad = structuredClone(outputs['budget2027-provenance.json'].entries);
  const key = Object.keys(bad).find((k) => !bad[k].operands)!;
  bad[key].printed = '1,0';
  expect(() => verifyParliamentCells(bytes, bad)).toThrow('physical cell differs');
});
it('independently decodes the complete adopted-law table from Word XML', () => {
  const table = readExecutionLawXml(zipMember(bytes, 'word/document.xml'));
  expect(table.rows).toEqual(forecast.tables.annex1_execution2026.rows);
});
