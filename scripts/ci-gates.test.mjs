import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const workflow = readFileSync('.github/workflows/data.yml', 'utf8');
test('one Node suite command and explicit validation barrier', () => {
  assert.equal((workflow.match(/run: pnpm test -- --coverage/g) || []).length, 1);
  assert.equal((workflow.match(/vitest run/g) || []).length, 0);
  const deps = workflow
    .match(/required-validation:[\s\S]*?needs:\s*\[([^\]]+)\]/)[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const jobs = [
    ...workflow.slice(workflow.indexOf('jobs:\n')).matchAll(/^  ([a-z][\w-]*):\n(?:    |\n)/gm),
  ]
    .map((x) => x[1])
    .filter((x) => x !== 'required-validation');
  for (const job of jobs) assert.ok(deps.includes(job), `missing gate ${job}`);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}[\s\S]*Every validation must succeed/);
});
test('all retained provenance and browser commands stay in CI', () => {
  const evidence = JSON.parse(readFileSync('scripts/ci-provenance-commands.json', 'utf8'));
  for (const [path, commands] of Object.entries(evidence)) {
    const raw = readFileSync(path, 'utf8')
      .split('\n')
      .map((x) => x.trim().replace(/^(?:- )?run: /, ''));
    const current = raw.map((x) =>
      x === 'bash scripts/ci-install-browser.sh'
        ? 'pnpm exec playwright install --with-deps chromium'
        : x,
    );
    for (const command of commands) assert.ok(current.includes(command), command);
  }
});

test('ETL coverage includes the standalone entry point and retains shared production globs', async () => {
  const { default: config } = await import('../apps/etl/vitest.config.ts');
  assert.deepEqual(config.test.coverage.include, [
    'src/**/*.{ts,js}',
    'bin/**/*.js',
    'publication-documents/prepare.mjs',
  ]);
});

test('coverage CI checks the target baseline with history and env refs before running suites', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs.test;
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  const gate = job.steps.findIndex(
    (step) => step.run === 'node scripts/check-coverage.mjs --check-base',
  );
  assert.ok(gate >= 0);
  assert.deepEqual(job.steps[gate].env, {
    COVERAGE_BASE_REF: '${{ github.base_ref }}',
    COVERAGE_BASE_SHA: '${{ github.event.before }}',
  });
  assert.ok(gate < job.steps.findIndex((step) => step.run === 'pnpm test -- --coverage'));
});
