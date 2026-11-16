/** Build the current data from the clean checkout and compare every data byte. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRelease } from '../packages/ingest/dist/release-build/index.js';
import { productionExecutor } from '../packages/ingest/dist/production/index.js';
import { listFiles } from '../packages/ingest/dist/release-package/files.js';
const root = resolve(import.meta.dirname, '..');
const pointer = JSON.parse(
  await readFile(join(root, 'data/release/releases/current.json'), 'utf8'),
);
const work = await mkdtemp(join(tmpdir(), 'sigma-budget-reproduce-'));
try {
  const result = await buildRelease({
    repositoryRoot: root,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    inputRoot: root,
    outputRoot: join(work, 'candidate'),
    buildDate: pointer.built,
    executor: await productionExecutor(root),
    maxObjectBytes: 67108864,
  });
  const expected = (await listFiles(join(root, 'data/release'))).filter(
    (path) => !path.startsWith('releases/'),
  );
  const actual = await listFiles(join(result.outputRoot, 'data'));
  assert.deepEqual(actual, expected, 'Every committed data file must be rebuilt');
  for (const path of expected)
    assert.deepEqual(
      await readFile(join(result.outputRoot, 'data', path)),
      await readFile(join(root, 'data/release', path)),
      path,
    );
  console.log(
    JSON.stringify({
      buildDate: pointer.built,
      files: expected.length,
      result: 'all data files byte-identical',
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
