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
test('all retained provenance commands stay in CI', () => {
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

test('committed release checks use Node with repository inputs', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const jobs = parse(workflow).jobs;
  const steps = jobs.check.steps;
  const compile = steps.findIndex(
    (step) => step.run === 'pnpm --filter @sigma-budget/etl... build',
  );
  const validate = steps.findIndex((step) => step.run === './budget check-site --inputs .');
  assert.ok(compile >= 0 && validate > compile);
  assert.equal(steps[validate].if, undefined);
  assert.ok(!steps[validate]['continue-on-error']);
  assert.ok(jobs.reproduce.steps.some((step) => step.run === 'node scripts/reproduce-current.mjs'));
});

test('check job checks the registries with the full history, so the historical producers are looked up', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs.check;
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  const built = job.steps.findIndex(
    (step) => step.run === 'pnpm --filter @sigma-budget/etl... build',
  );
  const check = job.steps.findIndex((step) =>
    step.run?.includes('node packages/ingest/dist/validate/cli.js --live --only REGISTRY'),
  );
  assert.ok(built >= 0 && check > built);
  const run = job.steps[check].run;
  // a skipped lookup fails the step, and so does a failing validator
  assert.match(
    run,
    /if grep -q 'verification skipped' "\$RUNNER_TEMP\/registry\.json"; then\n(?:.*\n)*?\s*exit 1\n\s*fi/,
  );
  assert.match(run, /\|\| status=\$\?\n/);
  assert.match(run, /\nexit "\$status"\n?$/);
});

test('security covers other PR targets without duplicating main PR checks', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const data = parse(workflow);
  const security = parse(readFileSync('.github/workflows/security.yml', 'utf8'));
  assert.deepEqual(data.on.pull_request.branches, ['main']);
  assert.deepEqual(security.on.pull_request, { 'branches-ignore': ['main'] });
  assert.ok(Object.hasOwn(security.on, 'workflow_call'));
  assert.deepEqual(Object.keys(security.jobs).sort(), ['dependencies-and-secrets', 'semgrep']);
});
