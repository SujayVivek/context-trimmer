import { describe, it, expect } from 'vitest';
import { collectToolCalls, isPinned } from '../src/transcript/index.js';
import type { Message } from '../src/types/index.js';

describe('Transcript Layer - collectToolCalls & isPinned', () => {
  it('1. should handle one tool call with one result', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Initial prompt' },
      {
        role: 'assistant',
        text: 'Executing read file',
        toolUses: [
          { tool_use_id: 'tu_1', tool: 'readFile', input: { path: 'a.txt' } },
        ],
      },
      {
        role: 'user',
        text: 'Result here',
        toolResults: [{ tool_use_id: 'tu_1', text: 'file content' }],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: 't1',
      tool_use_id: 'tu_1',
      tool: 'readFile',
      input: { path: 'a.txt' },
      callIndex: 1,
      resultIndex: 2,
      resultChars: 12,
      isError: false,
      pinned: false,
    });
  });

  it('2. should collect multiple tool calls', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      {
        role: 'assistant',
        text: 'Running tool 1',
        toolUses: [
          { tool_use_id: 'tu_1', tool: 'toolA', input: { arg: 1 } },
        ],
      },
      {
        role: 'user',
        text: 'Result 1',
        toolResults: [{ tool_use_id: 'tu_1', text: 'Res1' }],
      },
      {
        role: 'assistant',
        text: 'Running tool 2',
        toolUses: [
          { tool_use_id: 'tu_2', tool: 'toolB', input: { arg: 2 } },
        ],
      },
      {
        role: 'user',
        text: 'Result 2',
        toolResults: [{ tool_use_id: 'tu_2', text: 'Res2' }],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.tool_use_id).toBe('tu_1');
    expect(calls[1]?.tool_use_id).toBe('tu_2');
  });

  it('3. should correctly pair calls and results separated by other messages', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      {
        role: 'assistant',
        text: 'Use tool 1',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      { role: 'user', text: 'Unrelated message 1' },
      { role: 'assistant', text: 'Unrelated message 2' },
      {
        role: 'user',
        text: 'Tool result delivered later',
        toolResults: [{ tool_use_id: 'tu_1', text: 'delayed result' }],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.callIndex).toBe(1);
    expect(calls[0]?.resultIndex).toBe(4);
    expect(calls[0]?.resultChars).toBe('delayed result'.length);
  });

  it('4. should ignore tool calls with missing results', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      {
        role: 'assistant',
        text: 'Tool without result',
        toolUses: [{ tool_use_id: 'tu_unresolved', tool: 't_none', input: {} }],
      },
      {
        role: 'assistant',
        text: 'Tool with result',
        toolUses: [{ tool_use_id: 'tu_resolved', tool: 't_ok', input: {} }],
      },
      {
        role: 'user',
        text: 'Result for resolved',
        toolResults: [{ tool_use_id: 'tu_resolved', text: 'ok' }],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool_use_id).toBe('tu_resolved');
  });

  it('5. should assign sequential internal IDs t1, t2, t3...', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      {
        role: 'assistant',
        text: 'Multiple uses',
        toolUses: [
          { tool_use_id: 'tu_a', tool: 'a', input: {} },
          { tool_use_id: 'tu_b', tool: 'b', input: {} },
          { tool_use_id: 'tu_c', tool: 'c', input: {} },
        ],
      },
      {
        role: 'user',
        text: 'Multiple results',
        toolResults: [
          { tool_use_id: 'tu_a', text: 'res_a' },
          { tool_use_id: 'tu_b', text: 'res_b' },
          { tool_use_id: 'tu_c', text: 'res_c' },
        ],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls.map((c) => c.id)).toEqual(['t1', 't2', 't3']);
  });

  it('6. should record correct callIndex and resultIndex', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      { role: 'user', text: 'Msg 1' },
      {
        role: 'assistant',
        text: 'Msg 2 call',
        toolUses: [{ tool_use_id: 'tu_x', tool: 'tx', input: {} }],
      },
      { role: 'user', text: 'Msg 3' },
      {
        role: 'user',
        text: 'Msg 4 result',
        toolResults: [{ tool_use_id: 'tu_x', text: 'output' }],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls[0]?.callIndex).toBe(2);
    expect(calls[0]?.resultIndex).toBe(4);
  });

  it('7. should calculate correct resultChars', () => {
    const text = 'Hello, ContextSieve!';
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      {
        role: 'assistant',
        text: 'Call',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't', input: {} }],
      },
      {
        role: 'user',
        text: 'Result',
        toolResults: [{ tool_use_id: 'tu_1', text }],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls[0]?.resultChars).toBe(text.length);
  });

  it('8. should handle error result flag correctly', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Start' },
      {
        role: 'assistant',
        text: 'Failing tool',
        toolUses: [{ tool_use_id: 'tu_err', tool: 'failTool', input: {} }],
      },
      {
        role: 'user',
        text: 'Error output',
        toolResults: [
          { tool_use_id: 'tu_err', text: 'Error trace', isError: true },
        ],
      },
    ];

    const calls = collectToolCalls(messages, 0);
    expect(calls[0]?.isError).toBe(true);
  });

  it('9. should pin tool calls occurring in the first message (index 0)', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        text: 'First message tool call',
        toolUses: [{ tool_use_id: 'tu_first', tool: 'init', input: {} }],
      },
      { role: 'user', text: 'Msg 1' },
      {
        role: 'user',
        text: 'Msg 2 result',
        toolResults: [{ tool_use_id: 'tu_first', text: 'done' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const calls = collectToolCalls(messages, 1);
    expect(calls[0]?.pinned).toBe(true);
  });

  it('10. should pin tool calls within the newest N messages', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      { role: 'user', text: 'Msg 1' },
      { role: 'user', text: 'Msg 2' },
      {
        role: 'assistant',
        text: 'Msg 3 call',
        toolUses: [{ tool_use_id: 'tu_recent', tool: 't', input: {} }],
      },
      {
        role: 'user',
        text: 'Msg 4 result',
        toolResults: [{ tool_use_id: 'tu_recent', text: 'ok' }],
      },
    ];

    const calls = collectToolCalls(messages, 2);
    expect(calls[0]?.pinned).toBe(true);
  });

  it('11. should not pin older tool calls outside first message and newest N', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Msg 1 call',
        toolUses: [{ tool_use_id: 'tu_old', tool: 't', input: {} }],
      },
      {
        role: 'user',
        text: 'Msg 2 result',
        toolResults: [{ tool_use_id: 'tu_old', text: 'ok' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const calls = collectToolCalls(messages, 2);
    expect(calls[0]?.pinned).toBe(false);
  });

  it('12. should handle preserveRecentMessages = 0 correctly', () => {
    expect(isPinned(0, 5, 0)).toBe(true);
    expect(isPinned(1, 5, 0)).toBe(false);
    expect(isPinned(4, 5, 0)).toBe(false);

    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Msg 1 call',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't', input: {} }],
      },
      {
        role: 'user',
        text: 'Msg 2 result',
        toolResults: [{ tool_use_id: 'tu_1', text: 'ok' }],
      },
    ];
    const calls = collectToolCalls(messages, 0);
    expect(calls[0]?.pinned).toBe(false);
  });

  it('13. should leave original transcript objects unchanged (immutability)', () => {
    const toolUseObj = { tool_use_id: 'tu_immut', tool: 't', input: { a: 1 } };
    const toolResultObj = { tool_use_id: 'tu_immut', text: 'result' };
    const msg0: Message = { role: 'user', text: 'Init' };
    const msg1: Message = { role: 'assistant', text: 'Call', toolUses: [toolUseObj] };
    const msg2: Message = { role: 'user', text: 'Res', toolResults: [toolResultObj] };

    const messages: Message[] = [msg0, msg1, msg2];
    const originalMessagesJson = JSON.stringify(messages);

    collectToolCalls(messages, 2);

    expect(JSON.stringify(messages)).toBe(originalMessagesJson);
    expect(toolUseObj).toEqual({ tool_use_id: 'tu_immut', tool: 't', input: { a: 1 } });
    expect(toolResultObj).toEqual({ tool_use_id: 'tu_immut', text: 'result' });
  });
});
