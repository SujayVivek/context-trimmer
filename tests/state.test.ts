import { describe, it, expect } from 'vitest';
import {
  createCompactionState,
  fitState,
  estimateTokens,
  goalFromMessages,
  STATE_CONTEXT_INSTRUCTION,
} from '../src/state/index.js';
import type { Message, ToolCall } from '../src/types/index.js';

describe('State Layer Tests', () => {
  it('1. Basic state creation', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Hello AI' },
      { role: 'assistant', text: 'Hello human' },
    ];
    const state = createCompactionState(messages, []);

    expect(state.context).toBe(STATE_CONTEXT_INSTRUCTION);
    expect(state.goal).toBe('Hello AI');
    expect(state.history).toHaveLength(2);
    expect(state.history[0]).toEqual({
      i: 0,
      role: 'user',
      text: 'Hello AI',
    });
  });

  it('2. Tool calls appear in the appropriate history entry', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Run tool' },
      { role: 'assistant', text: 'Executing tool' },
    ];
    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'tu_1',
        tool: 'execCommand',
        input: { cmd: 'ls' },
        callIndex: 1,
        resultIndex: 1,
        resultChars: 120,
        isError: false,
        pinned: true,
      },
    ];

    const state = createCompactionState(messages, calls);
    expect(state.history[1]?.tool_calls).toHaveLength(1);
    expect(state.history[1]?.tool_calls?.[0]?.id).toBe('t1');
    expect(state.history[1]?.tool_calls?.[0]?.tool).toBe('execCommand');
  });

  it('3. Tool results are represented by compact notes rather than full output', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      { role: 'assistant', text: 'Calling tool' },
    ];
    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'tu_1',
        tool: 'readFile',
        input: { path: 'file.txt' },
        callIndex: 1,
        resultIndex: 1,
        resultChars: 4500,
        isError: false,
        pinned: true,
      },
      {
        id: 't2',
        tool_use_id: 'tu_2',
        tool: 'readFile',
        input: { path: 'bad.txt' },
        callIndex: 1,
        resultIndex: 1,
        resultChars: 300,
        isError: true,
        pinned: true,
      },
    ];

    const state = createCompactionState(messages, calls);
    const toolCalls = state.history[1]?.tool_calls;
    expect(toolCalls?.[0]?.result).toBe('ok, 4500 chars (omitted)');
    expect(toolCalls?.[1]?.result).toBe('error, 300 chars (omitted)');
  });

  it('4. Goal is derived from recent user messages', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Goal message 1' },
      { role: 'assistant', text: 'Response 1' },
      { role: 'user', text: 'Goal message 2' },
      {
        role: 'user',
        text: '',
        toolResults: [{ tool_use_id: 'tu_1', text: 'tool result only' }],
      },
      { role: 'user', text: 'Goal message 3' },
    ];

    const derived = goalFromMessages(messages);
    expect(derived).toContain('Goal message 1');
    expect(derived).toContain('Goal message 2');
    expect(derived).toContain('Goal message 3');
    expect(derived).not.toContain('tool result only');
  });

  it('5. Explicit goal overrides derived goal', () => {
    const messages: Message[] = [{ role: 'user', text: 'Original user text' }];
    const state = createCompactionState(messages, [], 'Explicit User Goal');

    expect(state.goal).toBe('Explicit User Goal');
  });

  it('6. Long tool inputs are truncated', () => {
    const longInput = { data: 'A'.repeat(1000) };
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      { role: 'assistant', text: 'Call' },
    ];
    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'tu_1',
        tool: 'write',
        input: longInput,
        callIndex: 1,
        resultIndex: 1,
        resultChars: 10,
        isError: false,
        pinned: false,
      },
    ];

    const fitted = fitState(messages, calls, {
      maxTokens: 250,
      preserveRecentMessages: 0,
    });
    const toolCallInput = fitted.state.history.find((h) => h.tool_calls)?.tool_calls?.[0]?.input;
    expect(toolCallInput).toContain('... [truncated]');
    expect((toolCallInput || '').length).toBeLessThan(1000);
  });

  it('7. Long conversational text is abridged', () => {
    const longText = 'Header context. ' + 'X'.repeat(500) + ' Footer context.';
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      { role: 'assistant', text: longText },
      { role: 'user', text: 'Msg 2' },
      { role: 'user', text: 'Msg 3' },
    ];

    const fitted = fitState(messages, [], {
      maxTokens: 220,
      preserveRecentMessages: 1,
    });
    const entryText = fitted.state.history[1]?.text || '';
    expect(entryText).toContain('[omitted');
    expect(entryText).toContain('chars]');
  });

  it('8. Older messages are sacrificed before pinned/recent messages', () => {
    const messages: Message[] = [
      { role: 'user', text: 'First msg (pinned)' },
      { role: 'assistant', text: 'Old response that can be omitted' },
      { role: 'user', text: 'Recent prompt (pinned)' },
      { role: 'assistant', text: 'Recent answer (pinned)' },
    ];

    const fitted = fitState(messages, [], {
      maxTokens: 180,
      preserveRecentMessages: 2,
    });

    expect(fitted.state.history[1]?.text).toBe('[conversational text omitted]');
    expect(fitted.state.history[2]?.text).toBe('Recent prompt (pinned)');
    expect(fitted.state.history[3]?.text).toBe('Recent answer (pinned)');
  });

  it('9. State fitting reports the stage used', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      { role: 'assistant', text: 'Some text' },
    ];

    const fitted1 = fitState(messages, [], { maxTokens: 1000 });
    expect(fitted1.stage).toBe('stage1');

    const fitted2 = fitState(messages, [], { maxTokens: 100 });
    expect(fitted2.stage).not.toBe('stage1');
  });

  it('10. State fitting throws when the configured limit is impossibly small', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Super long user request...' },
    ];

    expect(() =>
      fitState(messages, [], { maxTokens: 2 })
    ).toThrowError(/Unable to fit compaction state within token limit/);
  });

  it('11. estimateTokens is deterministic', () => {
    const text = 'Testing token estimation consistency across runs.';
    const val1 = estimateTokens(text);
    const val2 = estimateTokens(text);

    expect(val1).toBe(val2);
    expect(val1).toBe(Math.ceil(text.length / 3));
    expect(estimateTokens('')).toBe(0);
  });

  it('12. Original Message/ToolCall objects are not mutated', () => {
    const originalInput = { path: 'test.ts', content: 'hello' };
    const msg: Message = { role: 'user', text: 'Original Text' };
    const call: ToolCall = {
      id: 't1',
      tool_use_id: 'tu_1',
      tool: 'write',
      input: originalInput,
      callIndex: 0,
      resultIndex: 0,
      resultChars: 50,
      isError: false,
      pinned: false,
    };

    const messages = [msg];
    const calls = [call];

    const msgJson = JSON.stringify(messages);
    const callJson = JSON.stringify(calls);

    fitState(messages, calls, { maxTokens: 50 });

    expect(JSON.stringify(messages)).toBe(msgJson);
    expect(JSON.stringify(calls)).toBe(callJson);
  });
});
