import { describe, it, expect } from 'vitest';
import {
  compact,
  reductionRatio,
  applyDecisions,
  type CallDecision,
} from '../src/compaction/index.js';
import { MockDecisionBackend } from '../src/decisions/index.js';
import type { Message, ToolCall, DecisionBackend } from '../src/index.js';

describe('Compaction Engine Tests', () => {
  it('1. No tool calls', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi there' },
    ];
    const backend = new MockDecisionBackend();

    const result = await compact(messages, backend);
    expect(result.messages).toHaveLength(2);
    expect(result.decisions).toHaveLength(0);
    expect(result.stats.calls).toBe(0);
    expect(result.stats.requests).toBe(0);
    expect(reductionRatio(result)).toBe(0);
  });

  it('2. Only pinned tool calls', async () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        text: 'First msg call (pinned)',
        toolUses: [{ tool_use_id: 'tu_1', tool: 'init', input: {} }],
      },
      {
        role: 'user',
        text: 'First msg result',
        toolResults: [{ tool_use_id: 'tu_1', text: 'init result' }],
      },
    ];
    const backend = new MockDecisionBackend();

    const result = await compact(messages, backend, { preserveRecentMessages: 6 });
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.action).toBe('keep');
    expect(result.decisions[0]?.reason).toBe('pinned');
    expect(result.stats.requests).toBe(0);
  });

  it('3. Keep call + result', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call t1',
        toolUses: [{ tool_use_id: 'tu_1', tool: 'read', input: { p: 'a' } }],
      },
      {
        role: 'user',
        text: 'Result t1',
        toolResults: [{ tool_use_id: 'tu_1', text: 'content a' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 1 },
      result_t1: { type: 'noul', noul: 1 },
    });

    const result = await compact(messages, backend, { preserveRecentMessages: 1 });
    expect(result.decisions[0]?.action).toBe('keep');
    expect(result.decisions[0]?.reason).toBe('kept');
    expect(result.stats.kept).toBe(1);
  });

  it('4. Keep call but drop result', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call t1',
        toolUses: [{ tool_use_id: 'tu_1', tool: 'read', input: { p: 'a' } }],
      },
      {
        role: 'user',
        text: 'Result t1',
        toolResults: [{ tool_use_id: 'tu_1', text: 'X'.repeat(500) }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 1 },
      result_t1: { type: 'noul', noul: 0 },
    });

    const result = await compact(messages, backend, {
      preserveRecentMessages: 1,
      truncateHeadChars: 50,
    });

    expect(result.decisions[0]?.action).toBe('drop_result');
    expect(result.decisions[0]?.reason).toBe('result_dropped');
    expect(result.stats.resultsDropped).toBe(1);

    const resMsg = result.messages.find((m) => m.toolResults);
    expect(resMsg?.toolResults?.[0]?.text).toContain('... [remaining 450 chars removed by ContextSieve');
  });

  it('5. Drop call + result', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: '',
        toolUses: [{ tool_use_id: 'tu_1', tool: 'temp', input: {} }],
      },
      {
        role: 'user',
        text: '',
        toolResults: [{ tool_use_id: 'tu_1', text: 'temp output' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 0 },
      result_t1: { type: 'noul', noul: 0 },
    });

    const result = await compact(messages, backend, { preserveRecentMessages: 1 });
    expect(result.decisions[0]?.action).toBe('drop_call');
    expect(result.decisions[0]?.reason).toBe('call_dropped');
    expect(result.stats.callsDropped).toBe(1);
    expect(result.messages).toHaveLength(4);
  });

  it('6. Pinned calls are never removed', async () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        text: 'Pinned call',
        toolUses: [{ tool_use_id: 'tu_pin', tool: 'init', input: {} }],
      },
      {
        role: 'user',
        text: 'Pinned res',
        toolResults: [{ tool_use_id: 'tu_pin', text: 'init text' }],
      },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 0 },
      result_t1: { type: 'noul', noul: 0 },
    });

    const result = await compact(messages, backend, { preserveRecentMessages: 2 });
    expect(result.decisions[0]?.action).toBe('keep');
    expect(result.decisions[0]?.reason).toBe('pinned');
  });

  it('7. Missing model answer is handled conservatively', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call t1',
        toolUses: [{ tool_use_id: 'tu_1', tool: 'read', input: {} }],
      },
      {
        role: 'user',
        text: 'Result t1',
        toolResults: [{ tool_use_id: 'tu_1', text: 'res' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({});
    const result = await compact(messages, backend, { preserveRecentMessages: 1 });

    expect(result.decisions[0]?.action).toBe('keep');
    expect(result.decisions[0]?.keepCall).toBe(1);
    expect(result.decisions[0]?.keepResult).toBe(1);
  });

  it('8. Multiple calls in one request', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Calls',
        toolUses: [
          { tool_use_id: 'tu_1', tool: 't1', input: {} },
          { tool_use_id: 'tu_2', tool: 't2', input: {} },
        ],
      },
      {
        role: 'user',
        text: 'Results',
        toolResults: [
          { tool_use_id: 'tu_1', text: 'r1' },
          { tool_use_id: 'tu_2', text: 'r2' },
        ],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 1 },
      result_t1: { type: 'noul', noul: 1 },
      call_t2: { type: 'noul', noul: 1 },
      result_t2: { type: 'noul', noul: 0 },
    });

    const result = await compact(messages, backend, {
      preserveRecentMessages: 1,
      maxRequestTokens: 10000,
    });

    expect(result.decisions).toHaveLength(2);
    expect(result.stats.requests).toBe(1);
  });

  it('9. Multiple batches', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
    ];
    for (let i = 1; i <= 6; i++) {
      messages.push({
        role: 'assistant',
        text: `Call ${i}`,
        toolUses: [{ tool_use_id: `tu_${i}`, tool: `tool_${i}`, input: {} }],
      });
      messages.push({
        role: 'user',
        text: `Result ${i}`,
        toolResults: [{ tool_use_id: `tu_${i}`, text: `res_${i}` }],
      });
    }
    messages.push({ role: 'user', text: 'Final msg' });

    const answers: Record<string, any> = {};
    for (let i = 1; i <= 6; i++) {
      answers[`call_t${i}`] = { type: 'noul', noul: 1 };
      answers[`result_t${i}`] = { type: 'noul', noul: 1 };
    }
    const backend = new MockDecisionBackend(answers);

    const result = await compact(messages, backend, {
      preserveRecentMessages: 1,
      maxRequestTokens: 400,
    });

    expect(result.stats.requests).toBeGreaterThan(1);
    expect(result.decisions).toHaveLength(6);
  });

  it('10. Request failure propagates', async () => {
    const failingBackend: DecisionBackend = {
      async ask() {
        throw new Error('API connection failed');
      },
    };

    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      {
        role: 'user',
        text: 'Result',
        toolResults: [{ tool_use_id: 'tu_1', text: 'r1' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    await expect(
      compact(messages, failingBackend, { preserveRecentMessages: 1 })
    ).rejects.toThrowError('API connection failed');
  });

  it('11. Tool result truncation works', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      {
        role: 'user',
        text: 'Result',
        toolResults: [{ tool_use_id: 'tu_1', text: '1234567890ABCDEF' }],
      },
    ];

    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'tu_1',
        tool: 't1',
        input: {},
        callIndex: 1,
        resultIndex: 2,
        resultChars: 16,
        isError: false,
        pinned: false,
      },
    ];

    const decisions: CallDecision[] = [
      {
        id: 't1',
        tool: 't1',
        keepCall: 1,
        keepResult: 0,
        action: 'drop_result',
        reason: 'result_dropped',
      },
    ];

    const res = applyDecisions(messages, decisions, calls, 5);
    expect(res[2]?.toolResults?.[0]?.text).toContain('12345');
    expect(res[2]?.toolResults?.[0]?.text).toContain('... [remaining 11 chars removed by ContextSieve');
  });

  it('12. Empty messages are removed', () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: '',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      {
        role: 'user',
        text: '',
        toolResults: [{ tool_use_id: 'tu_1', text: 'r1' }],
      },
      { role: 'user', text: 'Msg 3' },
    ];

    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'tu_1',
        tool: 't1',
        input: {},
        callIndex: 1,
        resultIndex: 2,
        resultChars: 2,
        isError: false,
        pinned: false,
      },
    ];

    const decisions: CallDecision[] = [
      {
        id: 't1',
        tool: 't1',
        keepCall: 0,
        keepResult: 0,
        action: 'drop_call',
        reason: 'call_dropped',
      },
    ];

    const res = applyDecisions(messages, decisions, calls, 10);
    expect(res).toHaveLength(2);
    expect(res[0]?.text).toBe('Msg 0');
    expect(res[1]?.text).toBe('Msg 3');
  });

  it('13. Original transcript is not mutated', async () => {
    const toolUse = { tool_use_id: 'tu_1', tool: 't1', input: { a: 1 } };
    const toolRes = { tool_use_id: 'tu_1', text: 'Hello World' };
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      { role: 'assistant', text: 'Call', toolUses: [toolUse] },
      { role: 'user', text: 'Result', toolResults: [toolRes] },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const msgJsonBefore = JSON.stringify(messages);
    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 1 },
      result_t1: { type: 'noul', noul: 0 },
    });

    await compact(messages, backend, { preserveRecentMessages: 1, truncateHeadChars: 2 });

    expect(JSON.stringify(messages)).toBe(msgJsonBefore);
    expect(toolRes.text).toBe('Hello World');
  });

  it('14. Correct statistics', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      {
        role: 'user',
        text: 'Result',
        toolResults: [{ tool_use_id: 'tu_1', text: 'Data output' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 1 },
      result_t1: { type: 'noul', noul: 0 },
    });

    const res = await compact(messages, backend, { preserveRecentMessages: 1 });
    expect(res.stats.messagesBefore).toBe(6);
    expect(res.stats.messagesAfter).toBe(6);
    expect(res.stats.calls).toBe(1);
    expect(res.stats.resultsDropped).toBe(1);
    expect(res.stats.charsAfter).toBeLessThan(res.stats.charsBefore);
  });

  it('15. Correct reductionRatio', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: '',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      {
        role: 'user',
        text: '',
        toolResults: [{ tool_use_id: 'tu_1', text: 'A'.repeat(1000) }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 0 },
      result_t1: { type: 'noul', noul: 0 },
    });

    const res = await compact(messages, backend, { preserveRecentMessages: 1 });
    const ratio = reductionRatio(res);
    expect(ratio).toBeGreaterThan(0.8);
  });

  it('16. Threshold behavior around 0.5', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Call',
        toolUses: [{ tool_use_id: 'tu_1', tool: 't1', input: {} }],
      },
      {
        role: 'user',
        text: 'Result',
        toolResults: [{ tool_use_id: 'tu_1', text: 'res' }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend1 = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 0.5 },
      result_t1: { type: 'noul', noul: 0.5 },
    });

    const res1 = await compact(messages, backend1, { preserveRecentMessages: 1, keepThreshold: 0.5 });
    expect(res1.decisions[0]?.action).toBe('keep');

    const backend2 = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 0.49 },
      result_t1: { type: 'noul', noul: 0.49 },
    });

    const res2 = await compact(messages, backend2, { preserveRecentMessages: 1, keepThreshold: 0.5 });
    expect(res2.decisions[0]?.action).toBe('drop_call');
  });

  it('17. A tool call with an error result is handled correctly', async () => {
    const messages: Message[] = [
      { role: 'user', text: 'Msg 0' },
      {
        role: 'assistant',
        text: 'Failing call',
        toolUses: [{ tool_use_id: 'tu_err', tool: 'exec', input: {} }],
      },
      {
        role: 'user',
        text: 'Error trace',
        toolResults: [{ tool_use_id: 'tu_err', text: 'Stack trace error', isError: true }],
      },
      { role: 'user', text: 'Msg 3' },
      { role: 'user', text: 'Msg 4' },
      { role: 'user', text: 'Msg 5' },
    ];

    const backend = new MockDecisionBackend({
      call_t1: { type: 'noul', noul: 1 },
      result_t1: { type: 'noul', noul: 0 },
    });

    const res = await compact(messages, backend, { preserveRecentMessages: 1, truncateHeadChars: 5 });
    expect(res.decisions[0]?.action).toBe('drop_result');
    expect(res.messages[2]?.toolResults?.[0]?.isError).toBe(true);
    expect(res.messages[2]?.toolResults?.[0]?.text).toContain('Stack');
  });
});
