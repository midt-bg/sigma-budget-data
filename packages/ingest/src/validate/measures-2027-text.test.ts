import { parseXml, descendants, xmlText } from '../readers/documents/xml.js';
import { buildWave13a } from '../build/wave13a.js';
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { zipMember } from '../build/annual-lineage.js';
import { readPdf } from '../readers/pdf/index.js';
import { sha256 } from '../readers/annual/index.js';

type Entry = {
  id: string;
  table: string;
  row: number;
  starts: string;
  name: string;
  text: string;
  quote: string;
  law?: string;
  page: number | null;
  sourceLocation?: { member: string; paragraph: number; table: number; row: number };
  to?: number;
  tablePage: number | null;
};
const root = resolve(import.meta.dirname, '../../../..');
const member = 'ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf';
const norm = (text: string) =>
  text
    .replace(/(?<=[А-Яа-яA-Za-z])-\n(?=[а-яa-z])/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
const numbers = (text: string) => new Set(norm(text).match(/\d+(?: \d{3})*(?:,\d+)?/gu) ?? []);
let measures: Record<string, Entry[]>;
let laws: Record<string, string>;
let release: any;
let provenance: any;
let nativeParagraphs: string[] | undefined;
const pages = new Map<number, string>();
const json = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8'));
beforeAll(async () => {
  const loaded = await json('data/inputs/measures_2027.json');
  measures = loaded.MEASURES_2027;
  laws = loaded.LAWS;
  release = await json('data/release/budget2027.json');
  provenance = await json('data/release/budget2027-provenance.json');
  const forecast = await json('data/inputs/budget_forecast_2027.json');
  if (forecast.source.format === 'docx') {
    const archive = await readFile(join(root, forecast.source.archive));
    const nodes = [
      ...descendants(parseXml(zipMember(archive, 'word/document.xml').toString('utf8'))),
    ];
    nativeParagraphs = nodes
      .filter((n) => n.local === 'p')
      .map((p) =>
        norm(
          [...descendants(p)]
            .filter((n) => n.local === 't')
            .map(xmlText)
            .join(''),
        ),
      );
    const outputs = buildWave13a({
      forecast,
      bill: await json('data/inputs/budget_bill_2027.json'),
      archives: { forecast: archive, bill: archive },
      legacy: Object.fromEntries(
        await Promise.all(
          ['outlook', 'revenue', 'expenditure', 'law'].map(async (k) => [
            k,
            await json(`data/release/${k}.json`),
          ]),
        ),
      ),
      buildDate: '2026-11-24',
    } as any);
    release = outputs['budget2027.json'];
    provenance = outputs['budget2027-provenance.json'];
    return;
  }
  const bytes = zipMember(
    await readFile(
      join(
        process.env.BUDGET_BUILD_ACCEPTED_INPUTS ?? root,
        'data/originals/budget_2027/ZDBRB-2027.zip',
      ),
    ),
    member,
  );
  expect(provenance.documents.forecast.member).toBe(member);
  expect(sha256(bytes)).toBe(provenance.documents.forecast.memberSha256);
  const doc = readPdf(bytes);
  for (let n = 40; n < 56; n++)
    pages.set(n, norm(doc.pages[n - 1]!.text).replace(new RegExp(`^${n} `), ''));
}, 120_000);
function each() {
  return Object.entries(measures).flatMap(([table, entries]) =>
    entries.map((entry) => ({ table, entry, row: release.forecast[entry.table][entry.row] })),
  );
}
function assertQuote(entry: Entry) {
  if (nativeParagraphs) {
    expect(entry.page).toBeNull();
    expect(entry.sourceLocation?.member).toBe('word/document.xml');
    expect(nativeParagraphs[entry.sourceLocation!.paragraph], entry.id).toContain(
      norm(entry.quote),
    );
    return;
  }
  if (entry.page === null) throw new Error('Missing source page');
  const last = entry.to ?? entry.page;
  expect(last, entry.id).toBeGreaterThanOrEqual(entry.page);
  const text = Array.from({ length: last - entry.page + 1 }, (_, i) =>
    pages.get(entry.page! + i),
  ).join(' ');
  expect(text, entry.id).toContain(norm(entry.quote));
  expect(pages.get(entry.page), entry.id).toContain(norm(entry.quote).slice(0, 60));
}
it('has one unique editorial entry for each printed measure, excluding the total', () => {
  const ids: string[] = [];
  for (const [table, entries] of Object.entries(measures)) {
    const rows = release.forecast[table];
    expect(rows.at(-1).label, table).toBe('Общо:');
    expect(entries, table).toHaveLength(rows.length - 1);
    expect(
      entries.map((e) => e.row),
      table,
    ).toEqual(rows.slice(0, -1).map((_: unknown, i: number) => i));
    expect(
      entries.every((e) => e.table === table),
      table,
    ).toBe(true);
    ids.push(...entries.map((e) => e.id));
  }
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
});
it('keeps starts aligned with each printed row in its position', () => {
  for (const { entry, row } of each())
    expect(norm(row.label).startsWith(norm(entry.starts)), entry.id).toBe(true);
});
it('finds every complete verbatim quote at its original PDF or native Word address', () => {
  for (const { entry } of each()) assertQuote(entry);
});
it('binds physical table addresses to every published cell of the same measure', () => {
  for (const { entry, row } of each()) {
    if (nativeParagraphs) {
      expect(entry.tablePage).toBeNull();
      for (const cell of Object.values(row.cells) as any[]) {
        const loc = provenance.entries[cell.provenance].location;
        expect(loc.table).toBe(entry.sourceLocation!.table);
        expect(loc.row).toBe(entry.sourceLocation!.row);
      }
      continue;
    }
    const actual = new Set(
      Object.values(row.cells).map((c: any) => provenance.entries[c.provenance].page),
    );
    expect(actual, entry.id).toEqual(new Set([entry.tablePage]));
  }
});
it('requires every named law in the law catalogue and the quote or printed row', () => {
  for (const { entry, row } of each()) {
    if (!entry.law) continue;
    expect(Object.hasOwn(laws, entry.law), entry.id).toBe(true);
    const source = norm(entry.quote + ' ' + row.label);
    expect(
      source.includes(entry.law) || source.includes(entry.law.replace(/^Закон /u, 'Закона ')),
      entry.id,
    ).toBe(true);
  }
});
it('takes every editorial number from that measure quote or printed row', () => {
  for (const { entry, row } of each()) {
    const source = new Set([...numbers(entry.quote), ...numbers(row.label)]);
    for (const field of ['name', 'text'] as const) {
      for (const number of numbers(entry[field]))
        expect(source.has(number), entry.id + ': ' + field + ' ' + number).toBe(true);
    }
  }
});
it('rejects one changed digit in a quote', () => {
  const entry = structuredClone(measures.II_7![0]!);
  entry.quote = entry.quote.replace(/\d/u, (digit) => String((Number(digit) + 1) % 10));
  expect(() => assertQuote(entry)).toThrow();
});
