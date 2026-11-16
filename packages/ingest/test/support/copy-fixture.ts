import { cpSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
export const editorialRoutes = 'data/inputs/editorial/routes.json';
export const fixturePath = (path: string) =>
  path.endsWith('/routes.json') ? editorialRoutes : path;
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
  if (evidence) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(evidence, target);
  }
};
