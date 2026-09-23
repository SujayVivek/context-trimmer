import type { ToolCall } from '../types/index.js';

/**
 * Compact state structure passed to decision backends for evaluation.
 */
export interface CompactionState {
  readonly toolCalls: readonly ToolCall[];
  readonly summary?: string;
  readonly totalChars: number;
}

/**
 * Creates a compact state snapshot prepared for decision evaluation.
 */
export function createCompactionState(
  toolCalls: ToolCall[],
  summary?: string
): CompactionState {
  const totalChars = toolCalls.reduce((sum, tc) => sum + tc.resultChars, 0);
  return {
    toolCalls: Object.freeze([...toolCalls]),
    summary,
    totalChars,
  };
}
