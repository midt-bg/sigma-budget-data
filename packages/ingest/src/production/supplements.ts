import { prepareExecution, type PrepareExecutionOptions } from '../readers/execution/producer.js';
import type { PinnedFile } from '../readers/workbooks/index.js';
import { readExecutionReport } from '../readers/execution/report.js';
import differences from '../validate/kfp-source-differences.json' with { type: 'json' };

/** Exact signed source differences, bound to original bytes, never a relaxed accounting tolerance. */
export function readHistoricalReport(input: PinnedFile) {
  return readExecutionReport(input, differences);
}

/** Production metadata and historical coverage, before the derived graph consumes execution. */
export function prepareProductionExecution(
  options: Omit<PrepareExecutionOptions, 'firstYear' | 'sourceDifferences'>,
) {
  const result = prepareExecution({
    ...options,
    firstYear: 2022,
    sourceDifferences: differences,
  });
  delete result.execution.meta.pending;
  const contract = result.execution.contract as {
    conversion: { years: string };
    blocks: { data: { note: string } };
  };
  contract.conversion.years = '2022–2025';
  contract.blocks.data.note =
    'cumulative since 1 January; 2022–2025 are derived by the conversion from BGN';
  result.provenance.rules.data = result.provenance.rules.data!.replace(
    '2024 and 2025',
    '2022–2025',
  );
  return result;
}
