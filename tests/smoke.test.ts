import { describe, it, expect } from 'vitest';
import {
  createTranscript,
  createCompactionState,
  type Message,
  type ToolCall,
  type DecisionBackend,
  type DecisionQuestion,
  type DecisionAnswer,
  type CompactionState,
} from '../src/index.js';

describe('ContextSieve Foundation Smoke Test', () => {
  it('should instantiate core data model types correctly', () => {
    const userMsg: Message = {
      role: 'user',
      text: 'Read file content',
    };

    const assistantMsg: Message = {
      role: 'assistant',
      text: 'Reading file...',
      toolUses: [
        {
          tool_use_id: 'tu_123',
          tool: 'read_file',
          input: { path: 'src/index.ts' },
        },
      ],
    };

    const transcript = createTranscript([userMsg, assistantMsg]);

    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[0]?.role).toBe('user');
    expect(transcript.messages[1]?.toolUses?.[0]?.tool).toBe('read_file');
  });

  it('should construct compact state snapshots', () => {
    const toolCall: ToolCall = {
      id: 't1',
      tool_use_id: 'tu_123',
      tool: 'read_file',
      input: { path: 'src/index.ts' },
      callIndex: 1,
      resultIndex: 2,
      resultChars: 500,
      isError: false,
      pinned: false,
    };

    const state = createCompactionState([toolCall], 'Summary of past steps');

    expect(state.toolCalls).toHaveLength(1);
    expect(state.totalChars).toBe(500);
    expect(state.summary).toBe('Summary of past steps');
  });

  it('should support model-independent DecisionBackend contract implementation', async () => {
    class MockDecisionBackend implements DecisionBackend {
      async ask(
        _state: CompactionState,
        questions: DecisionQuestion[]
      ): Promise<DecisionAnswer[]> {
        return questions.map((q) => ({
          questionId: q.id,
          toolCallId: q.toolCallId,
          action: 'keep',
          reasoning: 'Tool call is relevant for future steps',
        }));
      }
    }

    const backend = new MockDecisionBackend();
    const state = createCompactionState([]);
    const question: DecisionQuestion = {
      id: 'q1',
      toolCallId: 't1',
      prompt: 'Is reading src/index.ts still necessary?',
    };

    const answers = await backend.ask(state, [question]);

    expect(answers).toHaveLength(1);
    expect(answers[0]?.action).toBe('keep');
    expect(answers[0]?.toolCallId).toBe('t1');
  });
});
