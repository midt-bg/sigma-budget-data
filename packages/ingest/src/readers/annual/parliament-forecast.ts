import layout from './parliament-layout.json' with { type: 'json' };
import { readParliamentDocument } from './parliament-document.js';
import { forecastNumber } from './forecast.js';
import { assert, ws } from '../pdf/index.js';
import { annualValue } from './json.js';

type Data = Record<string, any>;
type Document = ReturnType<typeof readParliamentDocument>;

/** The layout contains only column semantics, units and reviewed physical
 * addresses/labels. Every printed value is read afresh from the DOCX bytes. */
export function extractParliamentForecast(document: Document, source: Data): Data {
  const tables: Data = {};
  for (const [key, spec] of Object.entries(layout) as [string, Data][]) {
    const physical = document.tables[spec.table]!;
    const headerText = physical.rows
      .slice(0, 3)
      .flat()
      .map((c) => c.text)
      .join(' ');
    for (const column of spec.columns)
      if (column.year)
        assert(
          headerText.includes(String(column.year)),
          `Missing printed year ${key}/${column.year}`,
        );
    assert(
      new Set(spec.rows.map((r: Data) => r.row)).size === spec.rows.length,
      `Duplicate physical row in ${key}`,
    );
    const n = spec.columns.length;
    const rows = spec.rows.map((row: Data) => {
      const cells = physical.rows[row.row];
      assert(cells && cells.length > n, `Missing physical row ${key}/${row.row}`);
      const text = cells.map((c) => ws(c.text));
      const label = key === 'annex2' ? text[1]! : ws(text.slice(0, -n).join(' '));
      assert(
        label.replace(/\s/gu, '') === row.label.replace(/\s/gu, ''),
        `Changed physical row identity ${key}/${row.row}`,
      );
      const printed = text.slice(-n).map((v) => v || null);
      const values = printed.map((p) => (p === null || p === '-' ? null : forecastNumber(p)));
      if (key !== 'annex2' && key !== 'VI_2')
        assert(
          printed.every((p, i) => !p || p === '-' || values[i] !== null),
          `Unparsed printed amount ${key}/${row.row}`,
        );
      let unit = key === 'annex2' ? text[2] || null : undefined;
      let unitRow = row.row;
      if (key === 'annex2' && !unit && cells[2]?.verticalMerge === 'continue') {
        while (unitRow > 0 && physical.rows[unitRow]?.[2]?.verticalMerge === 'continue') unitRow--;
        const origin = physical.rows[unitRow]?.[2];
        assert(
          origin?.verticalMerge === 'restart' && origin.text,
          `Missing merged unit ${key}/${row.row}`,
        );
        unit = ws(origin.text);
      }
      const units = key === 'annex2' ? Array(n).fill(unit) : row.units;
      return {
        label,
        printed,
        values,
        units,
        location: {
          member: 'word/document.xml',
          table: spec.table,
          row: row.row,
          columns: Array.from({ length: n }, (_, i) => cells.length - n + i),
          ...(key === 'annex2' ? { unitRow, unitColumn: 2 } : {}),
        },
        ...(key === 'annex2'
          ? {
              source_id: row.source_id,
              source_no: row.source_no,
              parent_context: row.parent_context,
              semantic_label: row.semantic_label,
            }
          : {}),
      };
    });
    tables[key] = {
      caption: spec.caption,
      columns: spec.columns,
      rows,
      sourceTable: spec.table,
      physicalFormat: 'docx',
    };
  }
  for (const [key, members, count, unit] of [
    ['annex3_mln', [16, 17], 63, 'млн. €'],
    ['annex3_pct_gdp', [18, 19], 64, '% от БВП'],
  ] as const) {
    const rows: Data[] = [];
    for (const number of members) {
      const part = document.embedded.find((e) => e.member.endsWith(`image${number}.emf`))!;
      const years = part.records
        .filter((r) => r.y < 45 && /^202\d$/.test(r.text))
        .sort((a, b) => a.x - b.x)
        .map((r) => r.text);
      assert(
        JSON.stringify(years) === JSON.stringify(['2025', '2026', '2027', '2028', '2029']),
        `Wrong embedded year columns ${part.member}`,
      );
      const grouped = new Map<number, typeof part.records>();
      for (const r of part.records) {
        if (!grouped.has(r.y)) grouped.set(r.y, []);
        grouped.get(r.y)!.push(r);
      }
      for (const [y, group] of [...grouped].sort(([a], [b]) => a - b)) {
        if (y < 45) continue;
        const labels = group.filter((r) => r.x < 500);
        const amounts = group.filter((r) => r.x >= 500);
        if (!labels.length || !amounts.length) continue;
        const printed: (string | null)[] = Array(5).fill(null);
        const offsets: (number | null)[] = Array(5).fill(null);
        for (const r of amounts) {
          const column = [620, 700, 780, 855, Infinity].findIndex((edge) => r.x < edge);
          assert(offsets[column] === null, `Ambiguous EMF cell ${part.member}/${y}/${column}`);
          printed[column] = ws(r.text) || null;
          offsets[column] = r.offset;
        }
        const values = printed.map((p) => (p === null || p === '-' ? null : forecastNumber(p)));
        assert(
          printed.every((p, i) => !p || p === '-' || values[i] !== null),
          `Unparsed EMF number ${part.member}/${y}`,
        );
        const label = ws(labels.map((r) => r.text).join(' '));
        rows.push({
          label,
          printed,
          values,
          units: Array(5).fill(label.replace(/\s/gu, '') === 'БВП' ? 'млн. €' : unit),
          location: { member: part.member, memberSha256: part.sha256, y, offsets },
        });
      }
    }
    assert(rows.length === count, `Consolidated forecast row count ${key}: ${rows.length}`);
    tables[key] = {
      caption: 'Приложение № 3: Консолидирана фискална програма',
      columns: [2025, 2026, 2027, 2028, 2029].map((year, i) => ({
        year,
        unit,
        vintage: ['отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'][i],
      })),
      rows,
      physicalFormat: 'emf',
    };
  }
  assert(Object.keys(tables).length === 35, 'Forecast table coverage');
  return annualValue({
    source,
    tables,
    publication: document.source.publication,
    physicalTables: document.tables.slice(12),
    limitations: [
      'DOCX addresses identify XML tables/cells or embedded EMF records; no stable PDF page numbers are claimed.',
    ],
  });
}
