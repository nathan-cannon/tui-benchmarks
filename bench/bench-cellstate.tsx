import React, { useState } from 'react';
import { render, useInput, Box, Text } from 'cellstate';
import { MockStdout, MockStdin } from './mock-stream.js';
import { computeStats, type BenchmarkResult } from './harness.js';
import { performance } from 'node:perf_hooks';
import {
  getMessageBody,
  getRole,
  headerText,
  inputLineText,
  STREAM_WORDS,
} from './content.js';

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

// CellState v0.1.1 bug: useInput listens on process.stdin, not the stdin passed to render().
function emitKeypressOnProcessStdin(char: string): number {
  const buf = Buffer.from(char);
  const t0 = performance.now();
  process.stdin.emit('data', buf);
  return t0;
}

function KeypressApp({ messageCount }: { messageCount: number }) {
  const [counter, setCounter] = useState(0);

  useInput((key) => {
    if (key.type === 'char') {
      setCounter((c) => c + 1);
    }
  });

  return <ChatUI messageCount={messageCount} counter={counter} />;
}

export async function benchCellState(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  const stdout = new MockStdout(120, 40);
  const stdin = new MockStdin();

  const app = render(<KeypressApp messageCount={messageCount} />, {
    stdout: stdout as unknown as import('tty').WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  });

  await drainFrames(stdout, 100);

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    emitKeypressOnProcessStdin('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`CellState warmup frame ${i} timed out`);
  }

  for (let i = 0; i < iterations; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    const t0 = emitKeypressOnProcessStdin('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`CellState frame ${i} timed out`);
    latencies.push(frame.ts - t0);
    bytesPerFrame.push(frame.bytes);
  }

  app.unmount();

  return {
    name: 'CellState',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}

function StreamingApp({ messageCount }: { messageCount: number }) {
  const [streamText, setStreamText] = useState('');

  useInput((key) => {
    if (key.type === 'char') {
      setStreamText((prev) => {
        const idx = prev ? prev.split(' ').length : 0;
        const word = STREAM_WORDS[idx % STREAM_WORDS.length]!;
        return prev ? prev + ' ' + word : word;
      });
    }
  });

  return (
    <ChatUI messageCount={messageCount} counter={0} streamingText={streamText} />
  );
}

export async function benchCellStateStreaming(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  const stdout = new MockStdout(120, 40);
  const stdin = new MockStdin();

  const app = render(<StreamingApp messageCount={messageCount} />, {
    stdout: stdout as unknown as import('tty').WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  });

  await drainFrames(stdout, 100);

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    emitKeypressOnProcessStdin('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`CellState streaming warmup frame ${i} timed out`);
  }

  for (let i = 0; i < iterations; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    const t0 = emitKeypressOnProcessStdin('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`CellState streaming frame ${i} timed out`);
    latencies.push(frame.ts - t0);
    bytesPerFrame.push(frame.bytes);
  }

  app.unmount();

  return {
    name: 'CellState',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}

async function drainFrames(stdout: MockStdout, quietMs: number): Promise<void> {
  while (true) {
    const frame = await stdout.nextFrameTimeout(quietMs);
    if (frame === null) break;
  }
}
