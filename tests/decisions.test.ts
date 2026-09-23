import { describe, it, expect } from 'vitest';
import {
  MockDecisionBackend,
  getNoulAnswer,
  getChoiceAnswer,
  getScoreAnswer,
  createCompactionState,
  type DecisionQuestions,
  type DecisionResponse,
  type NoulAnswer,
  type ChoiceAnswer,
  type ScoreAnswer,
} from '../src/index.js';

describe('Decision Layer Tests', () => {
  it('1. DecisionBackend can be implemented by a mock backend', async () => {
    const backend = new MockDecisionBackend();
    const state = createCompactionState([], []);
    const questions: DecisionQuestions = {};

    const response = await backend.ask(state, questions);
    expect(response).toBeDefined();
    expect(response.answers).toEqual({});
    expect(response.model).toBe('mock-decision-backend');
  });

  it('2. Noul questions and answers work', async () => {
    const noulAns: NoulAnswer = { type: 'noul', noul: 1 };
    const backend = new MockDecisionBackend({ q_noul: noulAns });
    const state = createCompactionState([], []);
    const questions: DecisionQuestions = {
      q_noul: {
        type: 'noul',
        instructions: 'Should t1 be preserved?',
        criteria: { true: 'Keep', false: 'Trim' },
      },
    };

    const response = await backend.ask(state, questions);
    const answer = getNoulAnswer(response, 'q_noul');
    expect(answer.noul).toBe(1);
  });

  it('3. Choice questions and answers work', async () => {
    const choiceAns: ChoiceAnswer = {
      type: 'choice',
      choice: 'keep_summary',
      confidence: 0.9,
      probabilities: { keep_full: 0.1, keep_summary: 0.9, trim: 0.0 },
    };
    const backend = new MockDecisionBackend({ q_choice: choiceAns });
    const state = createCompactionState([], []);
    const questions: DecisionQuestions = {
      q_choice: {
        type: 'choice',
        instructions: 'Choose retention level for tool call t1',
        criteria: {
          keep_full: 'Keep full tool call and result',
          keep_summary: 'Keep summary only',
          trim: 'Trim completely',
        },
      },
    };

    const response = await backend.ask(state, questions);
    const answer = getChoiceAnswer(response, 'q_choice');
    expect(answer.choice).toBe('keep_summary');
    expect(answer.confidence).toBe(0.9);
  });

  it('4. Score questions and answers work', async () => {
    const scoreAns: ScoreAnswer = {
      type: 'score',
      score: 8,
      confidence: 0.85,
      probabilities: { '8': 0.85, '9': 0.15 },
    };
    const backend = new MockDecisionBackend({ q_score: scoreAns });
    const state = createCompactionState([], []);
    const questions: DecisionQuestions = {
      q_score: {
        type: 'score',
        instructions: 'Rate the relevance of t1 from 1 to 10',
        criteria: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      },
    };

    const response = await backend.ask(state, questions);
    const answer = getScoreAnswer(response, 'q_score');
    expect(answer.score).toBe(8);
  });

  it('5. Missing answers produce a clear error when extracted', () => {
    const emptyResponse: DecisionResponse = { answers: {} };

    expect(() => getNoulAnswer(emptyResponse, 'non_existent')).toThrowError(
      'Missing answer for question ID "non_existent".'
    );
    expect(() => getChoiceAnswer(emptyResponse, 'non_existent')).toThrowError(
      'Missing answer for question ID "non_existent".'
    );
    expect(() => getScoreAnswer(emptyResponse, 'non_existent')).toThrowError(
      'Missing answer for question ID "non_existent".'
    );
  });

  it('6. Invalid answer types produce a clear error', () => {
    const response: DecisionResponse = {
      answers: {
        q1: { type: 'noul', noul: 1 },
      },
    };

    expect(() => getChoiceAnswer(response, 'q1')).toThrowError(
      'Invalid answer type for question ID "q1": expected ChoiceAnswer.'
    );
    expect(() => getScoreAnswer(response, 'q1')).toThrowError(
      'Invalid answer type for question ID "q1": expected ScoreAnswer.'
    );
    expect(() =>
      getNoulAnswer(
        {
          answers: {
            q2: {
              type: 'choice',
              choice: 'a',
              confidence: 1,
              probabilities: {},
            },
          },
        },
        'q2'
      )
    ).toThrowError(
      'Invalid answer type for question ID "q2": expected NoulAnswer.'
    );
  });

  it('7. State and questions are passed through without mutation', async () => {
    const backend = new MockDecisionBackend();
    const state = createCompactionState([{ role: 'user', text: 'Hello' }], []);
    const questions: DecisionQuestions = {
      q1: {
        type: 'noul',
        instructions: 'Test question',
      },
    };

    const stateJsonBefore = JSON.stringify(state);
    const questionsJsonBefore = JSON.stringify(questions);

    await backend.ask(state, questions);

    expect(JSON.stringify(state)).toBe(stateJsonBefore);
    expect(JSON.stringify(questions)).toBe(questionsJsonBefore);
  });
});
