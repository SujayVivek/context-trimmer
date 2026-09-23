import type { CompactionState } from '../state/index.js';

/**
 * Action decided by a model for a specific tool call or content block.
 */
export type DecisionAction = 'keep' | 'trim' | 'summarize';

/**
 * Represents a question posed to the decision backend regarding tool call retention.
 */
export interface DecisionQuestion {
  /** Unique question identifier */
  id: string;
  /** Target tool call ID (e.g., 't1', 't2') */
  toolCallId: string;
  /** Description or prompt context for the decision model */
  prompt: string;
}

/**
 * Structured answer returned by a decision backend.
 */
export interface DecisionAnswer {
  questionId: string;
  toolCallId: string;
  action: DecisionAction;
  reasoning?: string;
}

/**
 * Model-independent decision engine interface.
 * Decouples compaction decision logic from specific LLM implementations.
 */
export interface DecisionBackend {
  ask(
    state: CompactionState,
    questions: DecisionQuestion[]
  ): Promise<DecisionAnswer[]>;
}
