import { records, validate, Checks, budgetRows, billNumber } from './bill.js';
import { assert, ws } from '../pdf/index.js';
import { annualValue } from './json.js';
import { decimalSum } from '../../build/fiscal-annual.js';
import type { readParliamentDocument } from './parliament-document.js';

type Data = Record<string, any>;
type Document = ReturnType<typeof readParliamentDocument>;
const number = (s: string) => /^-?\d+(?:[\s\u00a0]\d+)*,\d+$/.test(s);
const sum = (xs: number[]) => decimalSum(xs);

export function extractParliamentBill(document: Document, source: Data): Data {
  const stream: any[] = [],
    tables: Data[] = [];
  const paragraphLocations = new Map<string, Data[]>();
  function paragraph(text: string, location: Data) {
    const value = ws(text);
    if (!value) return;
    stream.push([null, 'p', value]);
    if (!paragraphLocations.has(value)) paragraphLocations.set(value, []);
    paragraphLocations.get(value)!.push({ member: 'word/document.xml', ...location });
  }
  let chunk: Data | undefined;
  function flush() {
    if (chunk) {
      tables.push(chunk);
      stream.push([null, 't', chunk]);
      chunk = undefined;
    }
  }
  for (const event of document.events) {
    if (event.kind === 'row' && event.table === 11) {
      flush();
      break;
    }
    if (event.kind === 'row' && event.table >= 7) {
      flush();
      continue;
    }
    if (event.kind === 'paragraph') {
      flush();
      paragraph(event.text, { paragraph: event.paragraph });
      continue;
    }
    if (event.table === 0) continue;
    const raw = event.cells.map(ws),
      occupied = raw.filter(Boolean);
    if (occupied.length && /^(?:Чл\.|\(\d+\))/.test(occupied[0]!)) {
      flush();
      paragraph(occupied.join(' '), { table: event.table, row: event.row });
      continue;
    }
    if (!occupied.length) continue;
    if (chunk?.xmlTable !== event.table) flush();
    chunk ??= {
      id: `docx:${event.table}:${event.row}`,
      page: null,
      xmlTable: event.table,
      rowIndices: [],
      rawCells: [],
      physicalFormat: 'docx',
    };
    chunk.rawCells.push(raw);
    chunk.rowIndices.push(event.row);
  }
  flush();
  const { arts, misc } = records(stream);
  for (const items of Object.values(misc))
    for (const item of items) {
      if (!item.text) continue;
      const locations = paragraphLocations.get(item.text);
      if (locations?.length === 1) item.location = locations[0];
    }
  const checks = new Checks();
  validate(arts, checks);
  const otherTables: Data = {};
  for (const article of ['49', '50'])
    otherTables[article] = (misc[article] ?? [])
      .filter((item: Data) => 'table' in item)
      .flatMap((item: Data) => budgetRows(tables.find((t) => t.id === item.table)!));
  const debt = otherTables['50'];
  assert(debt.length, 'Article 50 debt table missing');
  checks.equal(
    'DOCX article 50 total',
    debt.filter((r: Data) => /^\d+$/.test(r.no)).map((r: Data) => r.value),
    debt.at(-1).value,
  );
  const university = debt.find((r: Data) => r.no === '5');
  assert(university, 'Article 50 university row missing');
  checks.equal(
    'DOCX article 50 university subgroups',
    debt
      .filter((r: Data) => r.text.startsWith('А)') || r.text.startsWith('Б)'))
      .map((r: Data) => r.value),
    university.value,
  );
  checks.equal(
    'DOCX article 50 university detail',
    debt.filter((r: Data) => r.no.startsWith('5.')).map((r: Data) => r.value),
    university.value,
  );
  function municipal(index: number, cols: string[]) {
    const raw = document.tables[index]!.rows.map((r) => r.map((c) => ws(c.text)));
    const table = {
      id: `docx:${index}`,
      page: null,
      rawCells: raw,
      xmlTable: index,
      physicalFormat: 'docx',
    };
    tables.push(table);
    let region = '',
      total: number[] | undefined,
      totalRow: number | undefined;
    const rows: Data[] = [];
    raw.forEach((cells, row) => {
      const label = cells[0]!;
      if (label.startsWith('ОБЛАСТ')) {
        region = label;
        return;
      }
      if (cells.length !== cols.length + 1 || !cells.slice(1).every(number)) return;
      const values = cells.slice(1).map((s) => billNumber(s) as number);
      if (label.startsWith('ВСИЧКО')) {
        total = values;
        totalRow = row;
        return;
      }
      assert(region || label === 'Столична община', 'Municipal region missing');
      rows.push({
        name: label,
        region: label === 'Столична община' ? 'ОБЛАСТ СОФИЯ (СТОЛИЦА)' : region,
        values,
        page: null,
        table: table.id,
        location: {
          member: 'word/document.xml',
          table: index,
          row,
          columns: cols.map((_, i) => i + 1),
        },
      });
    });
    assert(
      rows.length === 265 && new Set(rows.map((r) => r.region + '/' + r.name)).size === 265,
      'Municipal inventory changed',
    );
    assert(total, 'Municipal total missing');
    cols.forEach((c, i) =>
      checks.equal(
        `DOCX municipal ${index}/${c}`,
        rows.map((r) => r.values[i]),
        total![i]!,
      ),
    );
    for (const row of rows) {
      const v = row.values;
      checks.equal(
        `DOCX municipal ${index}/${row.name}`,
        v.length === 5 ? v.slice(1) : [v[1], ...v.slice(4)],
        v[0],
      );
      if (v.length === 10)
        checks.equal(`DOCX municipal administration ${row.name}`, v.slice(2, 4), v[1]);
    }
    return {
      cols,
      rows,
      total,
      pages: [],
      table: table.id,
      totalLocation: {
        member: 'word/document.xml',
        table: index,
        row: totalRow,
        columns: cols.map((_, i) => i + 1),
      },
    };
  }
  const muni = {
    art52: municipal(7, ['total', 'delegated', 'equalizing', 'winterRoads', 'capital']),
    art53: municipal(10, [
      'delegated',
      'admin',
      'mayors',
      'adminStaff',
      'defence',
      'education',
      'health',
      'social',
      'culture',
      'economy',
    ]),
  };
  muni.art52.rows.forEach((row, i) => {
    const other = muni.art53.rows[i]!;
    assert(
      row.name === other.name && row.region === other.region,
      'Municipal cross-table identity',
    );
    checks.equal(`DOCX municipal delegated ${row.name}`, [row.values[1]], other.values[0]);
  });
  const projectRaw = document.tables[11]!.rows.map((r) => r.map((c) => ws(c.text)));
  tables.push({
    id: 'docx:11',
    page: null,
    rawCells: projectRaw,
    xmlTable: 11,
    physicalFormat: 'docx',
  });
  const projectRows = projectRaw.slice(1).map((r, i) => {
    assert(r.length === 8 && Number(r[0]) === i + 1, 'Project sequence changed');
    return {
      n: i + 1,
      id: r[1],
      name: r[2],
      values: r.slice(3, 6).map(billNumber),
      indicator: r[6],
      institution: r[7],
      pages: [],
      table: 'docx:11',
      page: null,
      location: { member: 'word/document.xml', table: 11, row: i + 1, columns: [3, 4, 5] },
    };
  });
  assert(
    projectRows.length === 225 && new Set(projectRows.map((r) => r.id)).size === 225,
    'Parliamentary project inventory',
  );
  const sums = Object.fromEntries(
    ['bill', 'billMc'].map((variant) => {
      const selected = Object.entries(arts)
        .filter(([a]) => a !== '1')
        .map(
          ([, occurrences]) =>
            occurrences[variant === 'billMc' && occurrences.length === 2 ? 1 : 0]!,
        );
      checks.equal(
        `${variant} aggregate expenditure`,
        selected.map((b) => b.headline.exp),
        sum(selected.map((b) => b.policyTotal)),
      );
      return [
        variant,
        {
          budgets: selected.length,
          expKhil: sum(selected.map((b) => b.headline.exp)),
          revKhil: sum(selected.map((b) => b.headline.rev ?? 0)),
        },
      ];
    }),
  );
  return annualValue({
    year: 2027,
    unit: 'хил. евро',
    source,
    publication: document.source.publication,
    bill: Object.fromEntries(Object.entries(arts).map(([a, occ]) => [a, occ[0]])),
    billMc: Object.fromEntries(
      Object.entries(arts)
        .filter(([, occ]) => occ.length === 2)
        .map(([a, occ]) => [a, occ[1]]),
    ),
    municipal: muni,
    projects: {
      article: 108,
      annex: 2,
      years: [2027, 2028, 2029],
      unit: 'хил. евро',
      rows: projectRows,
      pages: [],
    },
    articles: misc,
    otherTables,
    tables,
    sums,
    checks: checks.results,
    limitations: [
      'Word table/cell addresses are authoritative; no fixed PDF pagination is claimed.',
    ],
  });
}
