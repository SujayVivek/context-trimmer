import { describe, it, expect } from 'vitest';
import {
  createTranscript,
  createCompactionState,
  MockDecisionBackend,
  getChoiceAnswer,
  type Message,
  type ToolCall,
  type DecisionQuestions,
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
    const userMsg: Message = { role: 'user', text: 'Read src/index.ts' };
    const toolCall: ToolCall = {
      id: 't1',
      tool_use_id: 'tu_123',
      tool: 'read_file',
      input: { path: 'src/index.ts' },
      callIndex: 0,
      resultIndex: 1,
      resultChars: 500,
      isError: false,
      pinned: false,
    };

    const state = createCompactionState([userMsg], [toolCall], 'Summary of past steps');

    expect(state.history).toHaveLength(1);
    expect(state.goal).toBe('Summary of past steps');
  });

  it('should support model-independent DecisionBackend contract implementation', async () => {
    const backend = new MockDecisionBackend({
      q1: {
        type: 'choice',
        choice: 'keep',
        confidence: 0.95,
        probabilities: { keep: 0.95, trim: 0.05 },
      },
    });

    const state = createCompactionState([], []);
    const questions: DecisionQuestions = {
      q1: {
        type: 'choice',
        instructions: 'Should t1 be kept?',
        criteria: { keep: 'Keep tool call', trim: 'Trim tool call' },
      },
    };

    const response = await backend.ask(state, questions);

    expect(response.model).toBe('mock-decision-backend');
    const answer = getChoiceAnswer(response, 'q1');
    expect(answer.choice).toBe('keep');
  });
});
