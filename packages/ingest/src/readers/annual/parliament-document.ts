import { createHash } from 'node:crypto';
import { parseLegalDocx } from '../documents/docx.js';
import { parseXml, descendants, xmlText } from '../documents/xml.js';
import { readFiscalZipMember, readEmfTexts } from '../fiscal-documents/emf.js';
import { assert } from '../pdf/index.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const PARLIAMENT_PUBLICATION = '2026-11-16';
export const PARLIAMENT_DOCUMENT = 'data/originals/budget_2027_parliament/52-602-01-71.docx';
export const PARLIAMENT_SHA256 = '183c1863afb530446fa9a2eb34ea253de7ef83e48270b0550b7546787fb2db0f';

/** Read the actual OOXML grids and embedded vector text. A Word file has no
 * stable page geometry: physical addresses are member/table/row/cell or EMF
 * record offsets, never guessed PDF page numbers. */
export function readParliamentDocument(bytes: Uint8Array) {
  const document = parseLegalDocx(bytes);
  const xml = readFiscalZipMember(bytes, 'word/document.xml');
  const root = parseXml(xml.toString('utf8'));
  const nodes = [...descendants(root)];
  const word = (n: (typeof nodes)[number], local: string) => n.uri === W && n.local === local;
  const text = (n: (typeof nodes)[number]) =>
    [...descendants(n)]
      .filter((c) => word(c, 't'))
      .map(xmlText)
      .join('');
  const physicalTables = nodes.filter((n) => word(n, 'tbl'));
  const paragraphNodes = nodes.filter((n) => word(n, 'p'));
  const events: (
    | { kind: 'paragraph'; text: string; paragraph: number }
    | { kind: 'row'; table: number; row: number; cells: string[] }
  )[] = [];
  function walk(n: (typeof nodes)[number]): void {
    if (word(n, 'p')) {
      events.push({ kind: 'paragraph', text: text(n), paragraph: paragraphNodes.indexOf(n) });
      return;
    }
    if (word(n, 'tbl')) {
      const index = physicalTables.indexOf(n);
      n.children
        .filter((c) => word(c, 'tr'))
        .forEach((tr, row) => {
          const cells = tr.children.filter((c) => word(c, 'tc'));
          if (cells.some((c) => c.children.some((t) => word(t, 'tbl')))) {
            for (const cell of cells)
              for (const child of cell.children)
                if (word(child, 'p') || word(child, 'tbl')) walk(child);
          } else
            events.push({
              kind: 'row',
              table: index,
              row,
              cells: document.tables[index]!.rows[row]!.map((c) => c.text),
            });
        });
      return;
    }
    for (const child of n.children)
      if (word(child, 'p') || word(child, 'tbl') || word(child, 'body')) walk(child);
  }
  walk(root);
  assert(
    !nodes.some((n) => n.uri === W && ['ins', 'del', 'altChunk'].includes(n.local)),
    'Unsupported tracked changes or external document content',
  );
  const paragraphs = nodes
    .filter((n) => n.uri === W && n.local === 'p')
    .map((p) =>
      [...descendants(p)]
        .filter((n) => n.uri === W && n.local === 't')
        .map(xmlText)
        .join(''),
    );
  assert(
    paragraphs.slice(0, 12).some((p) => p.includes('52-602-01-71')) &&
      paragraphs.slice(0, 12).some((p) => p.includes('16.11.2026')),
    'Unexpected parliamentary edition',
  );
  assert(document.tables.length === 46, 'Parliamentary table inventory changed');
  const embedded = [16, 17, 18, 19].map((i) => {
    const member = `word/media/image${i}.emf`;
    const raw = readFiscalZipMember(bytes, member);
    return { member, sha256: sha256(raw), records: readEmfTexts(raw) };
  });
  assert(
    embedded.every((e) => e.records.some((r) => /Приходи|разходи/.test(r.text))),
    'Missing embedded consolidated fiscal tables',
  );
  return {
    ...document,
    paragraphs,
    events,
    embedded,
    source: {
      file: PARLIAMENT_DOCUMENT,
      sha256: sha256(bytes),
      publication: PARLIAMENT_PUBLICATION,
      url: 'https://www.parliament.bg/bills/52/52-602-01-71.docx',
      format: 'docx',
      member: 'word/document.xml',
      memberSha256: sha256(xml),
    },
  };
}
