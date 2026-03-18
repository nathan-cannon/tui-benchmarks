// Theoretical ceiling: renders synchronously in the event handler (no React).
// The gap between Raw and CS Pipeline is the cost of React reconciliation.

import { MockStdout, MockStdin } from './mock-stream.js';
import { computeStats, type BenchmarkResult } from './harness.js';
import {
  getMessageBody,
  getRole,
  headerText,
  inputLineText,
  STREAM_WORDS,
} from './content.js';

const ESC = '\x1b';
const CSI = `${ESC}[`;
const DEC_2026_ON = `${CSI}?2026h`;
const DEC_2026_OFF = `${CSI}?2026l`;

function sgr(...codes: number[]): string {
  return `${CSI}${codes.join(';')}m`;
}
const RESET = sgr(0);
const BOLD = sgr(1);

function fgRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${CSI}38;2;${r};${g};${b}m`;
}

interface Cell {
  char: string;
  fg: string;
  bold: boolean;
}

const EMPTY_CELL: Cell = { char: ' ', fg: '', bold: false };

function cellsEqual(a: Cell, b: Cell): boolean {
  return a.char === b.char && a.fg === b.fg && a.bold === b.bold;
}

function createGrid(cols: number, rows: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ ...EMPTY_CELL })),
  );
}

// Grid height matches CellState's rasterize: Math.max(contentRows + 10, viewportRows).
// Must account for text wrapping so streaming content grows the grid like CellState does.
function wrappedRows(text: string, cols: number): number {
  if (text.length === 0) return 1;
  return Math.ceil(text.length / cols);
}

function computeContentRows(
  messageCount: number,
  cols: number,
  streamingText?: string,
): number {
  let rows = wrappedRows(headerText(messageCount), cols);
  for (let i = 0; i < messageCount; i++) {
    const { role } = getRole(i);
    rows += wrappedRows(role, cols);
    let body = getMessageBody(i);
    if (streamingText !== undefined && i === messageCount - 1 && i % 2 !== 0) {
      body = body + ' ' + streamingText;
    }
    rows += wrappedRows(body, cols);
  }
  rows += wrappedRows(inputLineText(0), cols);
  return rows;
}

function renderToFullGrid(
  grid: Cell[][],
  cols: number,
  messageCount: number,
  counter: number,
  streamingText?: string,
): number {
  const totalRows = grid.length;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r]![c] = { char: ' ', fg: '', bold: false };
    }
  }

  let row = 0;

  row += writeText(grid, row, 0, cols, headerText(messageCount), fgRgb('#5599ff'), true);

  for (let i = 0; i < messageCount; i++) {
    if (row >= totalRows - 1) break;
    const { role, isUser } = getRole(i);
    const roleFg = isUser ? fgRgb('#00cc66') : fgRgb('#cc66ff');

    row += writeText(grid, row, 0, cols, role, roleFg, true);
    if (row >= totalRows - 1) break;

    let body = getMessageBody(i);
    if (streamingText !== undefined && i === messageCount - 1 && !isUser) {
      body = body + ' ' + streamingText;
    }
    row += writeText(grid, row, 0, cols, body, '', false);
  }

  row += writeText(grid, row, 0, cols, inputLineText(counter), '', false);

  return row;
}

// Returns the number of rows consumed (>1 when text wraps).
function writeText(
  grid: Cell[][],
  row: number,
  startCol: number,
  maxCol: number,
  text: string,
  fg: string,
  bold: boolean,
): number {
  let r = row;
  let col = startCol;
  for (const ch of text) {
    if (col >= maxCol) {
      r++;
      col = 0;
    }
    if (r >= grid.length) break;
    grid[r]![col] = { char: ch, fg, bold };
    col++;
  }
  return r - row + 1;
}

function lastContentRow(grid: Cell[][]): number {
  for (let r = grid.length - 1; r >= 0; r--) {
    for (let c = 0; c < grid[r]!.length; c++) {
      const cell = grid[r]![c]!;
      if (cell.char !== ' ' || cell.fg !== '' || cell.bold) {
        return r;
      }
    }
  }
  return 0;
}

function extractViewport(
  fullGrid: Cell[][],
  scrollOffset: number,
  viewportRows: number,
  cols: number,
): Cell[][] {
  const viewport = createGrid(cols, viewportRows);
  for (let r = 0; r < viewportRows; r++) {
    const srcRow = scrollOffset + r;
    if (srcRow < fullGrid.length) {
      for (let c = 0; c < cols; c++) {
        viewport[r]![c] = fullGrid[srcRow]![c]!;
      }
    }
  }
  return viewport;
}

function serializeRowRange(
  grid: Cell[][],
  startRow: number,
  endRow: number,
  cols: number,
): string {
  let out = '';
  for (let r = startRow; r < endRow && r < grid.length; r++) {
    const viewportRow = r - startRow;
    out += `${CSI}${viewportRow + 1};1H`;
    let lastFg = '';
    let lastBold = false;
    for (let c = 0; c < cols; c++) {
      const cell = grid[r]![c]!;
      if (cell.bold !== lastBold || cell.fg !== lastFg) {
        if (cell.bold && cell.fg) {
          out += BOLD + cell.fg;
        } else if (cell.bold) {
          out += BOLD;
        } else if (cell.fg) {
          out += RESET + cell.fg;
        } else {
          out += RESET;
        }
        lastBold = cell.bold;
        lastFg = cell.fg;
      }
      out += cell.char;
    }
  }
  out += RESET;
  return out;
}

function diffAndEmit(
  prev: Cell[][],
  next: Cell[][],
  cols: number,
  rows: number,
): string {
  let out = '';
  let lastRow = -1;
  let lastCol = -1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = prev[r]![c]!;
      const n = next[r]![c]!;
      if (cellsEqual(p, n)) continue;

      if (r !== lastRow || c !== lastCol) {
        out += `${CSI}${r + 1};${c + 1}H`;
      }

      if (n.bold && n.fg) {
        out += BOLD + n.fg;
      } else if (n.bold) {
        out += BOLD;
      } else if (n.fg) {
        out += n.fg;
      } else {
        out += RESET;
      }

      out += n.char;
      lastRow = r;
      lastCol = c + 1;
    }
  }

  if (out.length > 0) {
    out += RESET;
  }
  return out;
}

function fullRedraw(viewport: Cell[][], cols: number, rows: number): string {
  let out = `${CSI}H`;
  for (let r = 0; r < rows; r++) {
    if (r > 0) out += `${CSI}${r + 1};1H`;
    let lastFg = '';
    let lastBold = false;
    for (let c = 0; c < cols; c++) {
      const cell = viewport[r]![c]!;
      if (cell.bold !== lastBold || cell.fg !== lastFg) {
        if (cell.bold && cell.fg) {
          out += BOLD + cell.fg;
        } else if (cell.bold) {
          out += BOLD;
        } else if (cell.fg) {
          out += RESET + cell.fg;
        } else {
          out += RESET;
        }
        lastBold = cell.bold;
        lastFg = cell.fg;
      }
      out += cell.char;
    }
  }
  out += RESET;
  return out;
}

interface RawRenderer {
  render(): void;
  stdout: MockStdout;
}

function createRenderer(
  stdout: MockStdout,
  cols: number,
  viewportRows: number,
  getState: () => {
    messageCount: number;
    counter: number;
    streamingText?: string;
  },
): RawRenderer {
  let scrollbackRows = 0;
  let prevViewport: Cell[][] | null = null;

  function render(): void {
    const { messageCount, counter, streamingText } = getState();

    const contentRows = computeContentRows(messageCount, cols, streamingText);
    const fullHeight = Math.max(contentRows + 10, viewportRows);
    const fullGrid = createGrid(cols, fullHeight);
    renderToFullGrid(fullGrid, cols, messageCount, counter, streamingText);

    const actualHeight = lastContentRow(fullGrid) + 1;
    const desiredScrollback = Math.max(0, actualHeight - viewportRows);

    if (desiredScrollback > scrollbackRows) {
      // Growth: pre-paint rows entering scrollback, push with newlines, then redraw viewport
      const scrollNeeded = desiredScrollback - scrollbackRows;
      let scrollSeq = '';

      let offset = scrollbackRows;
      let remaining = scrollNeeded;
      while (remaining > 0) {
        const batch = Math.min(remaining, viewportRows);

        scrollSeq += `${CSI}H`;
        scrollSeq += serializeRowRange(fullGrid, offset, offset + batch, cols);

        scrollSeq += `${CSI}${viewportRows};1H`;
        scrollSeq += '\n'.repeat(batch);

        offset += batch;
        remaining -= batch;
      }

      scrollbackRows = desiredScrollback;

      const viewport = extractViewport(fullGrid, scrollbackRows, viewportRows, cols);
      const redrawSeq = fullRedraw(viewport, cols, viewportRows);

      const output = DEC_2026_ON + scrollSeq + redrawSeq + DEC_2026_OFF;
      stdout.write(output);

      prevViewport = viewport;
    } else {
      scrollbackRows = desiredScrollback;
      const viewport = extractViewport(fullGrid, scrollbackRows, viewportRows, cols);

      let output: string;
      if (prevViewport === null) {
        const redrawSeq = fullRedraw(viewport, cols, viewportRows);
        output = DEC_2026_ON + redrawSeq + DEC_2026_OFF;
      } else {
        const diffSeq = diffAndEmit(prevViewport, viewport, cols, viewportRows);
        output = DEC_2026_ON + diffSeq + DEC_2026_OFF;
      }

      stdout.write(output);
      prevViewport = viewport;
    }
  }

  return { render, stdout };
}

export async function benchRaw(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  const cols = 120;
  const rows = 40;
  const stdout = new MockStdout(cols, rows);
  const stdin = new MockStdin();

  let counter = 0;
  const renderer = createRenderer(stdout, cols, rows, () => ({
    messageCount,
    counter,
  }));

  stdin.on('data', () => {
    counter++;
    renderer.render();
  });

  const initPromise = stdout.nextFrameTimeout(2000);
  renderer.render();
  const initFrame = await initPromise;
  if (!initFrame) throw new Error('Raw: initial frame timed out');

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Raw warmup frame ${i} timed out`);
  }

  for (let i = 0; i < iterations; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    const t0 = stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Raw frame ${i} timed out`);
    latencies.push(frame.ts - t0);
    bytesPerFrame.push(frame.bytes);
  }

  stdin.removeAllListeners();

  return {
    name: 'Raw',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}

export async function benchRawStreaming(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  const cols = 120;
  const rows = 40;
  const stdout = new MockStdout(cols, rows);
  const stdin = new MockStdin();

  let streamText = '';
  let wordIndex = 0;
  const renderer = createRenderer(stdout, cols, rows, () => ({
    messageCount,
    counter: 0,
    streamingText: streamText,
  }));

  stdin.on('data', () => {
    const word = STREAM_WORDS[wordIndex % STREAM_WORDS.length]!;
    streamText += (streamText ? ' ' : '') + word;
    wordIndex++;
    renderer.render();
  });

  const initPromise = stdout.nextFrameTimeout(2000);
  renderer.render();
  const initFrame = await initPromise;
  if (!initFrame) throw new Error('Raw streaming: initial frame timed out');

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Raw streaming warmup frame ${i} timed out`);
  }

  for (let i = 0; i < iterations; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    const t0 = stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Raw streaming frame ${i} timed out`);
    latencies.push(frame.ts - t0);
    bytesPerFrame.push(frame.bytes);
  }

  stdin.removeAllListeners();

  return {
    name: 'Raw',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}
