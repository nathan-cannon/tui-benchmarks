import { benchCellState, benchCellStateStreaming } from './bench-cellstate.js';
import { benchCellStatePipeline, benchCellStatePipelineStreaming } from './bench-cellstate-pipeline.js';
import { benchInk, benchInkStreaming } from './bench-ink.js';
import { benchRaw, benchRawStreaming } from './bench-raw.js';
import {
  printSizeResults,
  printSummaryTable,
  type BenchmarkResult,
} from './harness.js';
import { contentSizeBytes } from './content.js';

const TREE_SIZES = [10, 50, 100, 250, 500];
const ITERATIONS = 100;
const WARMUP = 15;

type BenchFn = (size: number, iter: number, warmup: number) => Promise<BenchmarkResult>;

interface BenchEntry {
  label: string;
  fn: BenchFn;
}

async function runScenario(
  scenarioName: string,
  benches: BenchEntry[],
): Promise<Map<number, BenchmarkResult[]>> {
  console.log(`\n  ┌${'─'.repeat(58)}┐`);
  console.log(`  │  ${scenarioName.padEnd(56)}│`);
  console.log(`  └${'─'.repeat(58)}┘`);

  const allResults = new Map<number, BenchmarkResult[]>();

  for (const size of TREE_SIZES) {
    console.log(`\n  Running ${scenarioName} for ${size} messages...`);
    const results: BenchmarkResult[] = [];

    for (const { label, fn } of benches) {
      try {
        const result = await fn(size, ITERATIONS, WARMUP);
        results.push(result);
        console.log(`    ${label.padEnd(14)} ${result.stats.median.toFixed(2)}ms median`);
      } catch (e) {
        console.log(`    ${label.padEnd(14)} FAILED: ${e}`);
      }
    }

    if (results.length > 0) {
      allResults.set(size, results);
      printSizeResults(size, results, scenarioName);
    }
  }

  return allResults;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          TUI Benchmark: Keypress-to-Frame Latency            ║');
  console.log('║  CellState (React) vs Ink (React) vs Raw (no framework)      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Iterations: ${ITERATIONS} | Warmup: ${WARMUP} | Terminal: 120x40`);

  const contentSizes = new Map<number, number>();
  for (const size of TREE_SIZES) {
    contentSizes.set(size, contentSizeBytes(size));
  }

  const s1Results = await runScenario(
    'Scenario 1: Single Cell Update',
    [
      { label: 'Raw', fn: benchRaw },
      { label: 'CS Pipeline', fn: benchCellStatePipeline },
      { label: 'CellState', fn: benchCellState },
      { label: 'Ink', fn: benchInk },
    ],
  );

  const s2Results = await runScenario(
    'Scenario 2: Streaming Append',
    [
      { label: 'Raw', fn: benchRawStreaming },
      { label: 'CS Pipeline', fn: benchCellStatePipelineStreaming },
      { label: 'CellState', fn: benchCellStateStreaming },
      { label: 'Ink', fn: benchInkStreaming },
    ],
  );

  if (s1Results.size > 0) {
    printSummaryTable('Single Cell Update', s1Results, contentSizes);
  }
  if (s2Results.size > 0) {
    printSummaryTable('Streaming Append', s2Results, contentSizes);
  }

  console.log('\n  Done.\n');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
