import type { CompactionState } from '../state/index.js';

/**
 * Noul (Binary/Boolean evaluation) decision question.
 */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: {
    true: string;
    false: string;
  };
}

/**
 * Choice (Categorical selection) decision question.
 */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

/**
 * Score (Numerical/Ordinal rating) decision question.
 */
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

/**
 * Union type representing any decision question variant.
 */
export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/**
 * Dictionary of decision questions keyed by unique question ID.
 */
export type DecisionQuestions = Record<string, DecisionQuestion>;

/**
 * Structured answer for Noul (binary) questions.
 */
export interface NoulAnswer {
  type?: 'noul';
  noul: number;
}

/**
 * Structured answer for Choice (categorical) questions.
 */
export interface ChoiceAnswer {
  type?: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/**
 * Structured answer for Score (numerical) questions.
 */
export interface ScoreAnswer {
  type?: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

/**
 * Union type representing any decision answer variant.
 */
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/**
 * Model usage metadata structure.
 */
export interface DecisionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

/**
 * Container returned by a DecisionBackend execution.
 */
export interface DecisionResponse {
  answers: Record<string, DecisionAnswer>;
  model?: string;
  usage?: DecisionUsage;
  metadata?: Record<string, unknown>;
}

/**
 * Model-independent interface for decision engines.
 * Pluggable backends (Jev, Laya, OpenAI, Local models, Mock) implement this interface.
 */
export interface DecisionBackend {
  ask(
    state: CompactionState,
    questions: DecisionQuestions
  ): Promise<DecisionResponse>;
}

/**
 * Deterministic mock backend for testing decision evaluation pipelines.
 */
export class MockDecisionBackend implements DecisionBackend {
  private predefinedAnswers: Record<string, DecisionAnswer>;

  constructor(answers: Record<string, DecisionAnswer> = {}) {
    this.predefinedAnswers = { ...answers };
  }

  setAnswer(questionId: string, answer: DecisionAnswer): void {
    this.predefinedAnswers[questionId] = answer;
  }

  async ask(
    _state: CompactionState,
    questions: DecisionQuestions
  ): Promise<DecisionResponse> {
    const answers: Record<string, DecisionAnswer> = {};
    for (const qId of Object.keys(questions)) {
      const ans = this.predefinedAnswers[qId];
      if (ans) {
        answers[qId] = ans;
      }
    }
    return {
      answers,
      model: 'mock-decision-backend',
    };
  }
}

/**
 * Safely extracts and validates a NoulAnswer from a DecisionResponse.
 */
export function getNoulAnswer(
  response: DecisionResponse,
  questionId: string
): NoulAnswer {
  const answer = response.answers[questionId];
  if (!answer) {
    throw new Error(`Missing answer for question ID "${questionId}".`);
  }
  if ('noul' in answer && typeof answer.noul === 'number') {
    return answer as NoulAnswer;
  }
  throw new Error(`Invalid answer type for question ID "${questionId}": expected NoulAnswer.`);
}

/**
 * Safely extracts and validates a ChoiceAnswer from a DecisionResponse.
 */
export function getChoiceAnswer(
  response: DecisionResponse,
  questionId: string
): ChoiceAnswer {
  const answer = response.answers[questionId];
  if (!answer) {
    throw new Error(`Missing answer for question ID "${questionId}".`);
  }
  if ('choice' in answer && typeof answer.choice === 'string') {
    return answer as ChoiceAnswer;
  }
  throw new Error(`Invalid answer type for question ID "${questionId}": expected ChoiceAnswer.`);
}

/**
 * Safely extracts and validates a ScoreAnswer from a DecisionResponse.
 */
export function getScoreAnswer(
  response: DecisionResponse,
  questionId: string
): ScoreAnswer {
  const answer = response.answers[questionId];
  if (!answer) {
    throw new Error(`Missing answer for question ID "${questionId}".`);
  }
  if ('score' in answer && typeof answer.score === 'number') {
    return answer as ScoreAnswer;
  }
  throw new Error(`Invalid answer type for question ID "${questionId}": expected ScoreAnswer.`);
}
