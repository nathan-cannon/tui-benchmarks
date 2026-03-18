export interface Stats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stddev: number;
}

export interface BenchmarkResult {
  name: string;
  treeSize: number;
  latencies: number[];
  bytesPerFrame: number[];
  stats: Stats;
  avgBytes: number;
}

export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, stddev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;

  const median = n % 2 === 0
    ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
    : sorted[Math.floor(n / 2)]!;

  const p95 = sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)]!;
  const p99 = sorted[Math.min(Math.ceil(n * 0.99) - 1, n - 1)]!;

  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    min: sorted[0]!,
    max: sorted[n - 1]!,
    mean,
    median,
    p95,
    p99,
    stddev,
  };
}

function fmt(v: number, decimals = 2): string {
  return v.toFixed(decimals);
}

function pad(s: string, width: number, align: 'left' | 'right' = 'right'): string {
  if (align === 'left') return s.padEnd(width);
  return s.padStart(width);
}

export function printSizeResults(
  treeSize: number,
  results: BenchmarkResult[],
  scenario?: string,
): void {
  console.log(`\n${'═'.repeat(90)}`);
  const label = scenario ? `  ${scenario} — ${treeSize} messages` : `  Tree Size: ${treeSize} messages`;
  console.log(label);
  console.log(`${'═'.repeat(90)}`);

  const header = [
    pad('Framework', 14, 'left'),
    pad('Mean', 10),
    pad('Median', 10),
    pad('P95', 10),
    pad('P99', 10),
    pad('Min', 10),
    pad('Max', 10),
    pad('Bytes/F', 10),
  ].join(' │ ');

  console.log(`  ${header}`);
  console.log(`  ${'─'.repeat(header.length)}`);

  for (const r of results) {
    const row = [
      pad(r.name, 14, 'left'),
      pad(fmt(r.stats.mean) + 'ms', 10),
      pad(fmt(r.stats.median) + 'ms', 10),
      pad(fmt(r.stats.p95) + 'ms', 10),
      pad(fmt(r.stats.p99) + 'ms', 10),
      pad(fmt(r.stats.min) + 'ms', 10),
      pad(fmt(r.stats.max) + 'ms', 10),
      pad(Math.round(r.avgBytes).toString(), 10),
    ].join(' │ ');
    console.log(`  ${row}`);
  }

  if (results.length >= 2) {
    console.log(`\n  Speedup ratios (median):`);
    const baseline = results[0]!;
    for (let i = 1; i < results.length; i++) {
      const r = results[i]!;
      const ratio = r.stats.median / baseline.stats.median;
      console.log(`    ${baseline.name} vs ${r.name}: ${fmt(ratio, 1)}x`);
    }
  }
}

export function printSummaryTable(
  label: string,
  allResults: Map<number, BenchmarkResult[]>,
  contentSizes?: Map<number, number>,
): void {
  const sizes = [...allResults.keys()].sort((a, b) => a - b);
  const frameworks = allResults.get(sizes[0]!)!.map((r) => r.name);

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  SUMMARY: ${label} — Median Latency (ms)`);
  console.log(`${'═'.repeat(90)}`);

  const hasContent = contentSizes && contentSizes.size > 0;
  const latHeader = [
    pad('Messages', 12, 'left'),
    ...(hasContent ? [pad('Content', 10)] : []),
    ...frameworks.map((f) => pad(f, 14)),
  ].join(' │ ');
  console.log(`  ${latHeader}`);
  console.log(`  ${'─'.repeat(latHeader.length)}`);

  for (const size of sizes) {
    const results = allResults.get(size)!;
    const row = [
      pad(size.toString(), 12, 'left'),
      ...(hasContent
        ? [pad(fmt(contentSizes!.get(size)! / 1024, 1) + ' KB', 10)]
        : []),
      ...results.map((r) => pad(fmt(r.stats.median), 14)),
    ].join(' │ ');
    console.log(`  ${row}`);
  }

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  SUMMARY: ${label} — Bytes Per Frame`);
  console.log(`${'═'.repeat(90)}`);

  const bytesHeader = [
    pad('Messages', 12, 'left'),
    ...frameworks.map((f) => pad(f, 14)),
  ].join(' │ ');
  console.log(`  ${bytesHeader}`);
  console.log(`  ${'─'.repeat(bytesHeader.length)}`);

  for (const size of sizes) {
    const results = allResults.get(size)!;
    const row = [
      pad(size.toString(), 12, 'left'),
      ...results.map((r) => pad(Math.round(r.avgBytes).toString(), 14)),
    ].join(' │ ');
    console.log(`  ${row}`);
  }
}
