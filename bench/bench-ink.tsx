import React, { useState } from 'react';
import { render, useInput, Box, Text } from 'ink';
import { MockStdout, MockStdin } from './mock-stream.js';
import { computeStats, type BenchmarkResult } from './harness.js';
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
      <Text bold color="#5599ff">
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
            <Text bold color={isUser ? '#00cc66' : '#cc66ff'}>
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

function KeypressApp({ messageCount }: { messageCount: number }) {
  const [counter, setCounter] = useState(0);

  useInput((input, _key) => {
    if (input) {
      setCounter((c) => c + 1);
    }
  });

  return <ChatUI messageCount={messageCount} counter={counter} />;
}

export async function benchInk(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  const stdout = new MockStdout(120, 40);
  const stdin = new MockStdin();

  const initPromise = stdout.nextFrameTimeout(5000);
  const app = render(<KeypressApp messageCount={messageCount} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  const initFrame = await initPromise;
  if (!initFrame) throw new Error('Ink: initial frame timed out');

  await drainFrames(stdout, 100);

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Ink warmup frame ${i} timed out`);
  }

  for (let i = 0; i < iterations; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    const t0 = stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Ink frame ${i} timed out`);
    latencies.push(frame.ts - t0);
    bytesPerFrame.push(frame.bytes);
  }

  app.unmount();

  return {
    name: 'Ink',
    treeSize: messageCount,
    latencies,
    bytesPerFrame,
    stats: computeStats(latencies),
    avgBytes: bytesPerFrame.reduce((s, b) => s + b, 0) / bytesPerFrame.length,
  };
}

function StreamingApp({ messageCount }: { messageCount: number }) {
  const [streamText, setStreamText] = useState('');

  useInput((input, _key) => {
    if (input) {
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

export async function benchInkStreaming(
  messageCount: number,
  iterations: number,
  warmup: number,
): Promise<BenchmarkResult> {
  const stdout = new MockStdout(120, 40);
  const stdin = new MockStdin();

  const initPromise = stdout.nextFrameTimeout(5000);
  const app = render(<StreamingApp messageCount={messageCount} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  const initFrame = await initPromise;
  if (!initFrame) throw new Error('Ink streaming: initial frame timed out');

  await drainFrames(stdout, 100);

  const latencies: number[] = [];
  const bytesPerFrame: number[] = [];

  for (let i = 0; i < warmup; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Ink streaming warmup frame ${i} timed out`);
  }

  for (let i = 0; i < iterations; i++) {
    const framePromise = stdout.nextFrameTimeout(2000);
    const t0 = stdin.emitKeypress('x');
    const frame = await framePromise;
    if (!frame) throw new Error(`Ink streaming frame ${i} timed out`);
    latencies.push(frame.ts - t0);
    bytesPerFrame.push(frame.bytes);
  }

  app.unmount();

  return {
    name: 'Ink',
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
