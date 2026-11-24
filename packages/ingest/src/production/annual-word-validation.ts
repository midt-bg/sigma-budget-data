import { parseXml, descendants, xmlText } from '../readers/documents/xml.js';
import type { ExecutionLawTable } from '../validate/execution-integrity.js';
import { readFiscalZipMember, readEmfTexts } from '../readers/fiscal-documents/emf.js';
import { createHash } from 'node:crypto';

export function verifyParliamentQuotes(
  archive: Uint8Array,
  measures: Record<string, any[]>,
): number {
  const root = parseXml(readFiscalZipMember(archive, 'word/document.xml').toString('utf8'));
  const paragraphs = [...descendants(root)].filter((n) => n.local === 'p');
  const norm = (s: string) => s.replace(/\s+/gu, ' ').trim();
  let count = 0;
  for (const entry of Object.values(measures).flat()) {
    const loc = entry.sourceLocation;
    const node =
      loc?.member === 'word/document.xml' && Number.isInteger(loc.paragraph)
        ? paragraphs[loc.paragraph]
        : undefined;
    const text =
      node &&
      norm(
        [...descendants(node)]
          .filter((n) => n.local === 't')
          .map(xmlText)
          .join(''),
      );
    if (
      !text ||
      typeof entry.quote !== 'string' ||
      !entry.quote.trim() ||
      !text.includes(norm(entry.quote))
    )
      throw new Error('Parliamentary measure quote differs: ' + entry.id);
    count++;
  }
  if (count !== 36) throw new Error('Parliamentary measure quote inventory');
  return count;
}

/** Re-open physical cells independently of the producer's extracted values. */
export function verifyParliamentCells(archive: Uint8Array, entries: Record<string, any>): number {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const root = parseXml(readFiscalZipMember(archive, 'word/document.xml').toString('utf8'));
  const nodes = [...descendants(root)];
  const tables = nodes.filter((n) => n.uri === w && n.local === 'tbl');
  const paragraphs = nodes.filter((n) => n.uri === w && n.local === 'p');
  const norm = (s: string) => s.replace(/\s+/gu, ' ').trim();
  const text = (n: typeof root) =>
    norm(
      [...descendants(n)]
        .filter((p) => p.uri === w && p.local === 't')
        .map(xmlText)
        .join(''),
    );
  const images = new Map<string, ReturnType<typeof readEmfTexts>>();
  const number = (s: string) => {
    const token = /^[-−]?\d[\d\s]*(?:,\d+)?/u.exec(s)?.[0];
    if (!token) throw new Error('Non-numeric parliamentary source cell');
    return Number(token.replace(/\s/gu, '').replace('−', '-').replace(',', '.'));
  };
  let count = 0;
  for (const entry of Object.values(entries)) {
    if (entry.operands) continue;
    const loc = entry.location;
    if (!loc) throw new Error('Missing native parliamentary location');
    let raw: string | undefined;
    if (loc.member === 'word/document.xml') {
      if (Number.isInteger(loc.paragraph)) {
        const p = paragraphs[loc.paragraph];
        if (!p || !text(p).includes(norm(entry.printed)))
          throw new Error('Parliamentary prose differs');
        raw = entry.printed;
      } else {
        const table = tables[loc.table];
        const row = table?.children.filter((n) => n.uri === w && n.local === 'tr')[loc.row];
        const col = entry.rawColumn ?? loc.columns[Number(entry.extraction.split('/').at(-1))];
        const cell = row?.children.filter((n) => n.uri === w && n.local === 'tc')[col];
        if (cell) raw = text(cell);
      }
    } else if (/^word\/media\/image(?:16|17|18|19)\.emf$/.test(loc.member)) {
      if (!images.has(loc.member)) {
        const bytes = readFiscalZipMember(archive, loc.member);
        if (createHash('sha256').update(bytes).digest('hex') !== loc.memberSha256)
          throw new Error('Parliamentary EMF hash differs');
        images.set(loc.member, readEmfTexts(bytes));
      }
      const col = Number(entry.extraction.split('/').at(-1));
      raw = images
        .get(loc.member)!
        .find((r) => r.offset === loc.offsets[col] && r.y === loc.y)?.text;
    }
    if (raw === undefined || number(raw) !== number(entry.printed))
      throw new Error('Parliamentary physical cell differs: ' + entry.output);
    count++;
  }
  return count;
}

/** Independent Annex 1 read from the authenticated XML member. This does not
 * consume the annual extractor's layout, numeric values or published output. */
export function readExecutionLawXml(bytes: Uint8Array): ExecutionLawTable {
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const root = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const nodes = [...descendants(root)];
  const is = (n: typeof root, name: string) => n.uri === namespace && n.local === name;
  const text = (n: typeof root) =>
    [...descendants(n)]
      .filter((p) => is(p, 't'))
      .map(xmlText)
      .join('')
      .replace(/\s+/gu, ' ')
      .trim();
  const tables = nodes.filter((n) => is(n, 'tbl'));
  const candidates = tables
    .map((table, index) => ({ table, index }))
    .filter(({ table }) => {
      const header = table.children
        .filter((n) => is(n, 'tr'))
        .slice(0, 3)
        .map(text)
        .join(' ');
      return (
        header.includes('2026') && header.includes('30.09.2026') && header.includes('Програма')
      );
    });
  if (candidates.length !== 1) throw new Error('Independent Word Annex 1 selection is ambiguous');
  const { table, index } = candidates[0]!;
  const allRows = table.children.filter((n) => is(n, 'tr'));
  const rows: ExecutionLawTable['rows'] = [];
  for (let rowIndex = 3; rowIndex < allRows.length; rowIndex++) {
    const cells = allRows[rowIndex]!.children.filter((n) => is(n, 'tc')).map(text);
    if (cells.length !== 6) throw new Error('Independent Word Annex 1 column count');
    const printed = cells.slice(1).map((p) => p || null);
    const values = printed.map((p) => {
      if (p === null) return null;
      if (!/^-?\d+(?:\s\d{3})*(?:,\d+)?%?$/u.test(p))
        throw new Error('Independent Word Annex 1 number');
      return Number(p.replace(/[\s%]/gu, '').replace(',', '.'));
    });
    rows.push({
      label: cells[0]!,
      printed,
      values,
      units: printed.map((p, c) => (c === 4 && p?.endsWith('%') ? '% от закона' : 'млн. €')),
      location: {
        member: 'word/document.xml',
        table: index,
        row: rowIndex,
        columns: [1, 2, 3, 4, 5],
      },
    });
  }
  if (
    rows.length !== 18 ||
    rows[0]?.label !== 'ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ' ||
    rows[17]?.label !== 'БЮДЖЕТНО САЛДО'
  )
    throw new Error('Independent Word Annex 1 row coverage');
  return {
    columns: [
      { year: 2026, vintage: 'програма', unit: 'млн. €', scope: 'КФП' },
      { year: 2026, vintage: 'отчет', unit: 'млн. €', scope: 'КФП' },
      { year: 2026, vintage: 'отчет', unit: 'млн. €', scope: 'национален бюджет' },
      { year: 2026, vintage: 'отчет', unit: 'млн. €', scope: 'ЕС' },
      { year: 2026, unit: '% от закона', scope: 'КФП' },
    ],
    rows,
  };
}
