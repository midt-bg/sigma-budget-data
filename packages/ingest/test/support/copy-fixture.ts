import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseYaml } from '../../src/io/registry.js';
export const editorialRoutes = 'data/inputs/editorial/routes.json';
export const fixturePath = (path: string) =>
  path.endsWith('/routes.json') ? editorialRoutes : path;

/** Present frozen evidence in the data-only layout; never modify the source corpus. */
export const copyFixture: typeof cpSync = (source, destination, options) => {
  cpSync(source, destination, options);
  if (typeof destination !== 'string' || !existsSync(join(destination, 'data'))) return;
  const target = join(destination, editorialRoutes);
  if (existsSync(target)) return;
  function find(directory: string): string | undefined {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === 'routes.json') return path;
      if (entry.isDirectory()) {
        const found = find(path);
        if (found) return found;
      }
    }
    return undefined;
  }
  const evidence = find(destination);
  if (!evidence) return;
  const oldPath = relative(destination, evidence).replaceAll('\\', '/');
  mkdirSync(dirname(target), { recursive: true });
  renameSync(evidence, target);
  // Only identity metadata changes its path; recorded hashes remain untouched.
  function relocateMetadata(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) relocateMetadata(path);
      else if (
        /manifest.*\.json$/i.test(entry.name) ||
        ['originals.sha256', 'sources.yaml', 'datasets.yaml'].includes(entry.name)
      ) {
        const text = readFileSync(path, 'utf8');
        if (text.includes(oldPath)) writeFileSync(path, text.replaceAll(oldPath, editorialRoutes));
      }
    }
  }
  relocateMetadata(join(destination, 'data'));
  const pins = join(destination, 'data/originals.sha256');
  if (existsSync(pins) && !readFileSync(pins, 'utf8').includes(editorialRoutes)) {
    const hash = createHash('sha256').update(readFileSync(target)).digest('hex');
    appendFileSync(pins, `${hash}  ${editorialRoutes}\n`);
    // The old INPUTS corpus did not hash site-owned routes. In the data layout
    // this is an additional authored input, registered to the existing editorial source.
    const registryPath = join(destination, 'data/sources.yaml');
    const registry = parseYaml(readFileSync(registryPath, 'utf8')) as any;
    const editorial = registry.sources.find((source: any) => source.id === 'wg');
    if (!editorial) throw new Error('Frozen corpus has no editorial source');
    editorial.files.push({ path: editorialRoutes });
    writeFileSync(registryPath, JSON.stringify(registry));
  }
};
