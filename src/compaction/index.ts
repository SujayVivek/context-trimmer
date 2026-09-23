import type { Transcript } from '../transcript/index.js';
import type { DecisionAnswer } from '../decisions/index.js';

/**
 * Output result structure after applying decisions to a transcript.
 */
export interface CompactionResult {
  readonly compactedTranscript: Transcript;
  readonly appliedDecisions: readonly DecisionAnswer[];
}

/**
 * Contract for applying decisions to an untouched original transcript.
 */
export interface CompactionEngine {
  applyDecisions(
    transcript: Transcript,
    decisions: DecisionAnswer[]
  ): CompactionResult;
}
