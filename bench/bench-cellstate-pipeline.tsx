import React, { useState, useLayoutEffect } from 'react';
import { Box, Text } from 'cellstate';
import { mountRoot } from 'cellstate/dist/tui/reconciler.js';
import { layout, contentHeight } from 'cellstate/dist/tui/layout.js';
import { rasterize } from 'cellstate/dist/tui/rasterizer.js';
import { diff, extractViewport, lastContentRow } from 'cellstate/dist/diff.js';
import type { TNode } from 'cellstate/dist/tui/nodes.js';
import type { CellGrid } from 'cellstate/dist/cell.js';
import { performance } from 'node:perf_hooks';
import { computeStats, type BenchmarkResult } from './harness.js';
import {
  getMessageBody,
  getRole,
  headerText,
  inputLineText,
  STREAM_WORDS,
} from './content.js';

// Exposed via useLayoutEffect so benchmarks can trigger setState from outside React
let globalSetCounter: ((fn: (c: number) => number) => void) | null = null;
let globalSetStreamText: ((fn: (s: string) => string) => void) | null = null;

function ChatUI({
  messageCount,
  counter,
  streamingText,
}: {
  messageCount: number;
  counter: number;
  streamingText?: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold fg="#5599ff">
        {headerText(messageCount)}
      </Text>
      {Array.from({ length: messageCount }, (_, i) => {
        const { role, isUser } = getRole(i);
        let body = getMessageBody(i);
        if (streamingText !== undefined && i === messageCount - 1 && !isUser) {
          body = body + ' ' + streamingText;
        }
        return (
          <Box key={i} flexDirection="column">
            <Text bold fg={isUser ? '#00cc66' : '#cc66ff'}>
              {role}
            </Text>
            <Text>{body}</Text>
          </Box>
        );
      })}
      <Text>{inputLineText(counter)}</Text>
    </Box>
  );
}

const COLS = 120;
const ROWS = 40;

function runPipeline(root: TNode, prevGrid: CellGrid): { viewportGrid: CellGrid; output: string } {
  layout(root, COLS, ROWS);
  const ch = contentHeight(root);
  const fullGrid = rasterize(root, COLS, Math.max(ch + 10, ROWS), 0);
  const actualHeight = lastContentRow(fullGrid) + 1;
  const scrollback = Math.max(0, actualHeight - ROWS);
  const viewportGrid = extractViewport(fullGrid, scrollback, ROWS);
  const result = diff(prevGrid, viewportGrid, 0, 0);
  return { viewportGrid, output: result.output };
}

// onFrame is called by the reconciler's resetAfterCommit
let latestRoot: TNode | null = null;
let rootResolve: ((root: TNode) => void) | null = null;

function onFrame(root: TNode): void {
  latestRoot = root;
  if (rootResolve) {
    const resolve = rootResolve;
    rootResolve = null;
    resolve(root);
  }
}

function waitForCommit(): Promise<TNode> {
  if (latestRoot) {
    const root = latestRoot;
    latestRoot = null;
    return Promise.resolve(root);
  }
  return new Promise((resolve) => { rootResolve = resolve; });
}

async function waitForSetterReady(
  getter: () => unknown,
  label: string,
): Promise<void> {
  if (!getter()) {
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  if (!getter()) {
    throw new Error(`CS Pipeline: ${label} not set after mount`);
  }
}

function KeypressApp({ messageCount }: { messageCount: number }) {
  const [counter, setCounter] = useState(0);

  useLayoutEffect(() => {
    globalSetCounter = setCounter;
    return () => { globalSetCounter = null; };
  }, []);

  return <ChatUI messageCount={messageCount} counter={counter} />;
}

export async function benchCellStatePipeline(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  latestRoot = null;
  rootResolve = null;

  mountRoot(<KeypressApp messageCount={messageCount} />, onFrame);

  let root = await waitForCommit();
  await waitForSetterReady(() => globalSetCounter, 'globalSetCounter');

  layout(root, COLS, ROWS);
  const ch0 = contentHeight(root);
  const fg0 = rasterize(root, COLS, Math.max(ch0 + 10, ROWS), 0);
  const ah0 = lastContentRow(fg0) + 1;
  const sb0 = Math.max(0, ah0 - ROWS);
  let prevGrid: CellGrid = extractViewport(fg0, sb0, ROWS);

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  // Same code path as measurement so JIT warms the right thing
  for (let i = 0; i < warmup; i++) {
    latestRoot = null;

    const t0 = performance.now();
    globalSetCounter!((c) => c + 1);
    await new Promise<void>((r) => queueMicrotask(r));
    root = await waitForCommit();

    const { viewportGrid } = runPipeline(root, prevGrid);
    const t1 = performance.now();

    prevGrid = viewportGrid;
    void t0; void t1;
  }

  // t0 before setState so reconciliation time is included
  for (let i = 0; i < iterations; i++) {
    latestRoot = null;

    const t0 = performance.now();
    globalSetCounter!((c) => c + 1);
    await new Promise<void>((r) => queueMicrotask(r));
    root = await waitForCommit();

    const { viewportGrid, output } = runPipeline(root, prevGrid);
    const t1 = performance.now();

    prevGrid = viewportGrid;
    latencies.push(t1 - t0);
    bytesPerFrame.push(output.length);
  }

  globalSetCounter = null;

  return {
    name: 'CS Pipeline',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}

function StreamingApp({ messageCount }: { messageCount: number }) {
  const [streamText, setStreamText] = useState('');

  useLayoutEffect(() => {
    globalSetStreamText = setStreamText;
    return () => { globalSetStreamText = null; };
  }, []);

  return (
    <ChatUI messageCount={messageCount} counter={0} streamingText={streamText} />
  );
}

export async function benchCellStatePipelineStreaming(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  latestRoot = null;
  rootResolve = null;

  mountRoot(<StreamingApp messageCount={messageCount} />, onFrame);

  let root = await waitForCommit();
  await waitForSetterReady(() => globalSetStreamText, 'globalSetStreamText');

  layout(root, COLS, ROWS);
  const ch0 = contentHeight(root);
  const fg0 = rasterize(root, COLS, Math.max(ch0 + 10, ROWS), 0);
  const ah0 = lastContentRow(fg0) + 1;
  const sb0 = Math.max(0, ah0 - ROWS);
  let prevGrid: CellGrid = extractViewport(fg0, sb0, ROWS);

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    latestRoot = null;

    const t0 = performance.now();
    globalSetStreamText!((prev) => {
      const idx = prev ? prev.split(' ').length : 0;
      const word = STREAM_WORDS[idx % STREAM_WORDS.length]!;
      return prev ? prev + ' ' + word : word;
    });
    await new Promise<void>((r) => queueMicrotask(r));
    root = await waitForCommit();

    const { viewportGrid } = runPipeline(root, prevGrid);
    const t1 = performance.now();

    prevGrid = viewportGrid;
    void t0; void t1;
  }

  for (let i = 0; i < iterations; i++) {
    latestRoot = null;

    const t0 = performance.now();
    globalSetStreamText!((prev) => {
      const idx = prev ? prev.split(' ').length : 0;
      const word = STREAM_WORDS[idx % STREAM_WORDS.length]!;
      return prev ? prev + ' ' + word : word;
    });
    await new Promise<void>((r) => queueMicrotask(r));
    root = await waitForCommit();

    const { viewportGrid, output } = runPipeline(root, prevGrid);
    const t1 = performance.now();

    prevGrid = viewportGrid;
    latencies.push(t1 - t0);
    bytesPerFrame.push(output.length);
  }

  globalSetStreamText = null;

  return {
    name: 'CS Pipeline',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}
