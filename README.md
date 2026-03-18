# tui-benchmarks

Frame latency benchmarks for terminal UI frameworks.

Measures the time from a state change to the frame being written to stdout. Two scenarios tested: single cell update (user typing) and streaming append (LLM token output). Three approaches compared: [CellState](https://github.com/nathan-cannon/cellstate) (React + cell-level diffing), [Ink](https://github.com/vadimdemedes/ink) (React + line-level rewriting), and hand-rolled escape codes (no framework).

## Results

Measured on Apple M4 Max, 120x40 terminal. 100 iterations, 15 warmup. Median latency in milliseconds.

### Scenario 1: Single cell update

A counter at the bottom of a chat UI is incremented. Everything else stays the same. This is the keypress responsiveness test.

| Messages | Content | Raw | CS Pipeline | CellState (e2e) | Ink |
|----------|---------|-----|-------------|-----------------|-----|
| 10 | 1.4 KB | 0.31 | 0.48 | 5.30 | 21.65 |
| 50 | 6.7 KB | 0.70 | 0.86 | 5.33 | 23.26 |
| 100 | 13.3 KB | 1.10 | 1.10 | 5.38 | 26.53 |
| 250 | 33.1 KB | 2.44 | 2.54 | 6.05 | 36.93 |
| 500 | 66.0 KB | 4.81 | 5.10 | 9.92 | 63.05 |

Bytes written to stdout per frame:

| Messages | Raw | CellState | Ink |
|----------|-----|-----------|------|
| 10 | 34 | 34 | 2,003 |
| 50 | 34 | 34 | 8,484 |
| 100 | 34 | 34 | 16,855 |
| 250 | 34 | 34 | 41,955 |
| 500 | 34 | 34 | 83,795 |

### Scenario 2: Streaming append

A word is appended to the last assistant message each frame, simulating LLM token streaming. Content grows over time, triggering text wrapping and scrollback management.

| Messages | Content | Raw | CS Pipeline | CellState (e2e) | Ink |
|----------|---------|-----|-------------|-----------------|-----|
| 10 | 1.4 KB | 0.30 | 0.45 | 16.95 | 23.94 |
| 50 | 6.7 KB | 0.73 | 0.94 | 17.89 | 23.72 |
| 100 | 13.3 KB | 1.12 | 1.12 | 19.71 | 27.71 |
| 250 | 33.1 KB | 2.48 | 2.71 | 20.44 | 43.82 |
| 500 | 66.0 KB | 4.82 | 5.31 | 25.14 | 62.83 |

Bytes written to stdout per frame:

| Messages | Raw | CellState | Ink |
|----------|-----|-----------|------|
| 10 | 66 | 41 | 2,448 |
| 50 | 332 | 315 | 8,901 |
| 100 | 387 | 370 | 17,271 |
| 250 | 332 | 315 | 42,372 |
| 500 | 387 | 370 | 84,211 |

## What the columns mean

**Raw** is hand-rolled escape codes with no framework. It maintains a cell buffer, tracks scrollback, extracts the viewport, diffs cell by cell, and writes minimal escape sequences. Everything happens synchronously in the event handler. This is the theoretical performance ceiling.

**CS Pipeline** is CellState's computation path timed directly: React reconciliation + layout + rasterize + viewport extraction + cell-level diff. The timer starts before `setState` so reconciler overhead is included. No frame loop scheduling.

**CellState (e2e)** is the full frame loop including intentional `setTimeout` batching. When an LLM streams tokens, each one triggers a React state update. The batching coalesces rapid updates into a single frame instead of rendering hundreds of times per second. The gap between CS Pipeline and CellState e2e is this deliberate scheduling delay, not computation.

**Ink** is React with Ink's rendering pipeline. Ink clears and rewrites every line on every frame regardless of what changed, which is why bytes scale linearly with content.

## What this shows

CS Pipeline stays within 1.0-1.6x of raw at every tree size. React's reconciler adds roughly 0.1-0.5ms of overhead. At 250 messages (33KB of content), the full pipeline takes 2.54ms for a keypress. That's not "orders of magnitude too slow." It's a rounding error inside a 16ms frame budget.

The bytes-per-frame tables explain why Ink is slow. For a single cell update, CellState and Raw both write 34 bytes regardless of tree size. Ink writes 83KB at 500 messages for the same 1-character change. The bottleneck is the output pipeline, not React.

The streaming scenario is harder. CellState e2e runs at 17-25ms because content growth triggers scrollback management (pre-painting rows before pushing them into the terminal scrollback buffer). Even so, CellState's pipeline computation stays under 6ms and it writes 41-370 bytes per frame compared to Ink's 42-84KB.

## Test UI

A chat interface simulating a coding agent. Messages alternate between short user prompts and longer assistant responses with realistic content. All three benchmarks render identical text from shared content definitions (`bench/content.ts`).

## Methodology notes

- All benchmarks use the same mock stdout/stdin. Frames are detected by the DEC 2026 synchronized output end marker (`\x1b[?2026l`).
- Raw renders synchronously in the event handler. CellState and Ink go through React's async reconciliation. This reflects real-world behavior: raw escape codes are synchronous, React-based frameworks are not.
- The raw benchmark does the same work as CellState: full-height rasterization, scrollback tracking, viewport extraction, cell-level diffing, and text wrapping. It is not a naive clear-and-rewrite.
- Content sizes in the table are approximate (plain text without ANSI escape codes).
- CellState v0.1.1 has a bug where `useInput` listens on `process.stdin` instead of the stdin passed to `render()`. The benchmark works around this by emitting keypresses on `process.stdin`.

## Running

```
git clone https://github.com/nathan-cannon/tui-benchmarks
cd tui-benchmarks
npm install
npx tsx bench/run.ts
```

Results will vary by hardware. The relative ratios between frameworks should be consistent.

## Adding a framework

Each framework gets its own file in `bench/`. The test UI must render identical content from `bench/content.ts`. Export async functions that return `BenchmarkResult` objects for both scenarios. See any existing benchmark file for the pattern.

PRs welcome.

## Frameworks tested

- [CellState](https://github.com/nathan-cannon/cellstate) — React terminal renderer with cell-level diffing
- [Ink](https://github.com/vadimdemedes/ink) — React for interactive command-line apps
- Raw — hand-rolled escape codes, no framework