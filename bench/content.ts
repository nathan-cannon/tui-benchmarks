// Shared across all benchmarks so each framework renders identical text.

export const USER_MESSAGES = [
  'Can you fix the bug in processEvent?',
  'What about the edge case with empty arrays?',
  'Can you add error handling to the API endpoint?',
  'How do I test this with mocked dependencies?',
  'Refactor this to use async/await instead of callbacks',
  'The CI is failing on the integration tests',
  'Can you split this into smaller functions?',
  'What does this regex do?',
  'Add a retry mechanism for the webhook calls',
  'Why is the memory usage spiking on this route?',
];

export const ASSISTANT_MESSAGES = [
  'Looking at processEvent, the issue is that the callback never fires after the timeout. The setTimeout wrapper prevents execution. I\'ll remove it and call the callback directly, then verify with the existing test suite.',
  'Good catch. When the input array is empty, the reduce call on line 45 throws because there\'s no initial value. I\'ll add an early return for empty arrays and a corresponding test case.',
  'I\'ve added try-catch blocks around the database calls and the external API request. Each error is logged with context and returns an appropriate HTTP status code. The validation middleware already handles malformed input.',
  'You can use jest.mock to replace the database module, then inject a fake response. I\'d recommend testing the happy path, a network timeout, and a malformed response. Here\'s a pattern that avoids coupling to the implementation details.',
  'Done. I replaced the nested callbacks with async/await and added proper error propagation. The control flow is much clearer now. The three existing tests still pass without modification.',
  'The integration test failure is a flaky timing issue. The test asserts immediately after the event fires but the handler runs on the next tick. I\'ve wrapped the assertion in a waitFor block with a 500ms timeout.',
  'I\'ve extracted three helpers: validateInput, transformPayload, and persistResult. Each is under 20 lines and independently testable. The main function now reads as a straightforward pipeline.',
  'That regex matches ISO 8601 timestamps with optional timezone offsets. The capture groups extract year, month, day, hour, minute, second, and offset separately. I\'d replace it with a Date.parse call for clarity.',
  'I\'ve added exponential backoff with jitter, capped at 3 retries. Failed attempts are logged with the response status and body. After exhausting retries, the error is surfaced to the caller with full context.',
  'The memory spike is from accumulating parsed JSON objects in the request handler closure. Each request holds a reference to the full response body until the GC runs. I\'ve moved the parsing into a streaming pipeline that processes chunks incrementally.',
];

export function getMessageBody(index: number): string {
  if (index % 2 === 0) {
    return USER_MESSAGES[Math.floor(index / 2) % USER_MESSAGES.length]!;
  }
  return ASSISTANT_MESSAGES[Math.floor(index / 2) % ASSISTANT_MESSAGES.length]!;
}

export function getRole(index: number): { role: string; isUser: boolean } {
  const isUser = index % 2 === 0;
  return { role: isUser ? 'user' : 'assistant', isUser };
}

export function headerText(messageCount: number): string {
  return `Agent v1.0 | session-bench | msgs: ${messageCount}`;
}

export function inputLineText(counter: number): string {
  return `❯ keypress count: ${counter}`;
}

export const STREAM_WORDS =
  'The issue is in the render function where the callback never fires after the timeout because the setTimeout wrapper prevents synchronous execution of the handler'.split(' ');

export function contentSizeBytes(messageCount: number): number {
  let content = headerText(messageCount) + '\n';
  for (let i = 0; i < messageCount; i++) {
    const { role } = getRole(i);
    content += role + '\n' + getMessageBody(i) + '\n';
  }
  content += inputLineText(0);
  return Buffer.byteLength(content);
}
