import type { Message, ToolCall } from '../types/index.js';
import { collectToolCalls } from '../transcript/index.js';
import { fitState, estimateTokens } from '../state/index.js';
import type { DecisionBackend, DecisionQuestions, DecisionResponse, NoulQuestion } from '../decisions/index.js';
import { getNoulAnswer } from '../decisions/index.js';

/**
 * Options for context compaction.
 */
export interface CompactOptions {
  goal?: string;
  /** Threshold for retaining tool call / result (default: 0.5) */
  keepThreshold?: number;
  /** Count of recent messages to preserve automatically (default: 6) */
  preserveRecentMessages?: number;
  /** Maximum token limit for state payload (default: 25000) */
  maxStateTokens?: number;
  /** Maximum token limit per model decision request (default: 30000) */
  maxRequestTokens?: number;
  /** Maximum character count to preserve when truncating tool result heads (default: 300) */
  truncateHeadChars?: number;
}

/**
 * Sanitized/Resolved compaction options with guaranteed non-negative defaults.
 */
export interface ResolvedCompactOptions {
  goal?: string;
  keepThreshold: number;
  preserveRecentMessages: number;
  maxStateTokens: number;
  maxRequestTokens: number;
  truncateHeadChars: number;
}

/**
 * Resolves raw CompactOptions with safe, sanitized defaults.
 */
export function resolveCompactOptions(options?: CompactOptions): ResolvedCompactOptions {
  const keepThreshold =
    options?.keepThreshold !== undefined
      ? Math.max(0, Math.min(1, options.keepThreshold))
      : 0.5;
  const preserveRecentMessages =
    options?.preserveRecentMessages !== undefined
      ? Math.max(0, Math.floor(options.preserveRecentMessages))
      : 6;
  const maxStateTokens =
    options?.maxStateTokens !== undefined
      ? Math.max(100, Math.floor(options.maxStateTokens))
      : 25000;
  const maxRequestTokens =
    options?.maxRequestTokens !== undefined
      ? Math.max(200, Math.floor(options.maxRequestTokens))
      : 30000;
  const truncateHeadChars =
    options?.truncateHeadChars !== undefined
      ? Math.max(0, Math.floor(options.truncateHeadChars))
      : 300;

  return {
    goal: options?.goal,
    keepThreshold,
    preserveRecentMessages,
    maxStateTokens,
    maxRequestTokens,
    truncateHeadChars,
  };
}

/**
 * Actions that can be applied to a tool call.
 */
export type CallAction = 'keep' | 'drop_result' | 'drop_call';

/**
 * Reason for the applied call action.
 */
export type DecisionReason = 'pinned' | 'kept' | 'result_dropped' | 'call_dropped';

/**
 * Final compaction decision for an individual tool call.
 */
export interface CallDecision {
  id: string;
  tool: string;
  keepCall: number;
  keepResult: number;
  action: CallAction;
  reason: DecisionReason;
}

/**
 * Statistics summarizing the outcome of compaction.
 */
export interface CompactStats {
  messagesBefore: number;
  messagesAfter: number;
  charsBefore: number;
  charsAfter: number;
  calls: number;
  kept: number;
  resultsDropped: number;
  callsDropped: number;
  pinned: number;
  stateTokens: number;
  stateStage: string;
  requests: number;
  ms: number;
}

/**
 * Comprehensive output result returned by compact().
 */
export interface CompactResult {
  messages: Message[];
  decisions: CallDecision[];
  stats: CompactStats;
}

/**
 * Calculates the character length reduction ratio achieved by compaction.
 * Returns 0 if charsBefore is 0.
 */
export function reductionRatio(result: CompactResult): number {
  if (result.stats.charsBefore === 0) {
    return 0;
  }
  return (result.stats.charsBefore - result.stats.charsAfter) / result.stats.charsBefore;
}

/**
 * Helper to calculate total character count of a transcript messages array.
 */
export function calculateTranscriptChars(messages: readonly Message[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.text) {
      count += m.text.length;
    }
    if (m.toolUses) {
      for (const u of m.toolUses) {
        if (u.text) count += u.text.length;
        if (u.tool) count += u.tool.length;
        if (u.input) {
          try {
            count += JSON.stringify(u.input).length;
          } catch {
            count += String(u.input).length;
          }
        }
      }
    }
    if (m.toolResults) {
      for (const r of m.toolResults) {
        if (r.text) count += r.text.length;
      }
    }
  }
  return count;
}

/**
 * Applies compaction decisions to a transcript array without mutating original objects.
 */
export function applyDecisions(
  messages: readonly Message[],
  decisions: readonly CallDecision[],
  calls: readonly ToolCall[],
  truncateHeadChars: number
): Message[] {
  const decisionByToolUseId = new Map<string, CallDecision>();
  for (const call of calls) {
    const dec = decisions.find((d) => d.id === call.id);
    if (dec) {
      decisionByToolUseId.set(call.tool_use_id, dec);
    }
  }

  const resultMessages: Message[] = [];

  for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
    const originalMsg = messages[msgIndex];
    if (!originalMsg) continue;

    let modified = false;
    let newText = originalMsg.text || '';

    // 1. Process ToolUses
    let newToolUses = originalMsg.toolUses ? [...originalMsg.toolUses] : undefined;
    if (originalMsg.toolUses && originalMsg.toolUses.length > 0) {
      const filteredUses = originalMsg.toolUses.filter((use) => {
        const dec = decisionByToolUseId.get(use.tool_use_id);
        if (dec && dec.action === 'drop_call') {
          return false;
        }
        return true;
      });

      if (filteredUses.length !== originalMsg.toolUses.length) {
        modified = true;
        newToolUses = filteredUses.length > 0 ? filteredUses : undefined;
      }
    }

    // 2. Process ToolResults
    let newToolResults = originalMsg.toolResults ? [...originalMsg.toolResults] : undefined;
    if (originalMsg.toolResults && originalMsg.toolResults.length > 0) {
      const updatedResults: typeof originalMsg.toolResults = [];

      for (const res of originalMsg.toolResults) {
        const dec = decisionByToolUseId.get(res.tool_use_id);

        if (dec && dec.action === 'drop_call') {
          modified = true;
          continue; // Remove tool result
        }

        if (dec && dec.action === 'drop_result') {
          modified = true;
          if (res.text.length > truncateHeadChars) {
            const removedChars = res.text.length - truncateHeadChars;
            const head = res.text.slice(0, truncateHeadChars);
            const truncatedText = `${head}\n... [remaining ${removedChars} chars removed by ContextSieve. Rerun tool if needed.]`;
            updatedResults.push({
              ...res,
              text: truncatedText,
            });
          } else {
            updatedResults.push(res);
          }
        } else {
          updatedResults.push(res);
        }
      }

      if (modified) {
        newToolResults = updatedResults.length > 0 ? updatedResults : undefined;
      }
    }

    // 3. Message empty check
    const isTextEmpty = !newText || newText.trim().length === 0;
    const hasNoUses = !newToolUses || newToolUses.length === 0;
    const hasNoResults = !newToolResults || newToolResults.length === 0;

    if (isTextEmpty && hasNoUses && hasNoResults) {
      // Completely empty message after drops -> remove message
      continue;
    }

    if (!modified) {
      resultMessages.push(originalMsg);
    } else {
      const newMsg: Message = {
        role: originalMsg.role,
        text: newText,
      };
      if (newToolUses) newMsg.toolUses = newToolUses;
      if (newToolResults) newMsg.toolResults = newToolResults;
      resultMessages.push(newMsg);
    }
  }

  return resultMessages;
}

/**
 * Main compaction engine execution.
 */
export async function compact(
  messages: readonly Message[],
  backend: DecisionBackend,
  options?: CompactOptions
): Promise<CompactResult> {
  const startTime = Date.now();
  const resolved = resolveCompactOptions(options);

  const calls = collectToolCalls(messages, resolved.preserveRecentMessages);
  const charsBefore = calculateTranscriptChars(messages);

  const pinnedCalls = calls.filter((c) => c.pinned);
  const candidateCalls = calls.filter((c) => !c.pinned);

  // If no candidate tool calls exist, return original transcript cleanly with stats
  if (candidateCalls.length === 0) {
    const decisions: CallDecision[] = pinnedCalls.map((c) => ({
      id: c.id,
      tool: c.tool,
      keepCall: 1,
      keepResult: 1,
      action: 'keep',
      reason: 'pinned',
    }));

    return {
      messages: [...messages],
      decisions,
      stats: {
        messagesBefore: messages.length,
        messagesAfter: messages.length,
        charsBefore,
        charsAfter: charsBefore,
        calls: calls.length,
        kept: calls.length,
        resultsDropped: 0,
        callsDropped: 0,
        pinned: pinnedCalls.length,
        stateTokens: 0,
        stateStage: 'stage1',
        requests: 0,
        ms: Date.now() - startTime,
      },
    };
  }

  // 1. Fit compact state
  const fitted = fitState(messages, calls, {
    maxTokens: resolved.maxStateTokens,
    goal: resolved.goal,
    preserveRecentMessages: resolved.preserveRecentMessages,
  });

  const stateTokens = fitted.tokens;
  const stateStage = fitted.stage;

  // 2. Build decision questions for candidate calls
  const stateTokensEstimate = estimateTokens(JSON.stringify(fitted.state));

  // Batching questions to respect maxRequestTokens
  const batches: DecisionQuestions[] = [];
  let currentBatch: DecisionQuestions = {};

  for (const call of candidateCalls) {
    const callQId = `call_${call.id}`;
    const resultQId = `result_${call.id}`;

    const callQ: NoulQuestion = {
      type: 'noul',
      instructions: "Does knowing that this tool was called, including its input, still matter to the assistant's future reasoning?",
    };
    const resultQ: NoulQuestion = {
      type: 'noul',
      instructions: 'Does the assistant still need the complete output of this tool call verbatim, rather than simply rerunning the tool?',
    };

    const callPairQuestions: DecisionQuestions = {
      [callQId]: callQ,
      [resultQId]: resultQ,
    };

    const singlePairTokens = estimateTokens(JSON.stringify(callPairQuestions));
    if (stateTokensEstimate + singlePairTokens + 50 > resolved.maxRequestTokens) {
      throw new Error(`Request size for a single question exceeds maxRequestTokens limit of ${resolved.maxRequestTokens}.`);
    }

    const testBatch = { ...currentBatch, ...callPairQuestions };
    const batchTokens = stateTokensEstimate + estimateTokens(JSON.stringify(testBatch)) + 50;

    if (batchTokens <= resolved.maxRequestTokens) {
      currentBatch = testBatch;
    } else {
      batches.push(currentBatch);
      currentBatch = { ...callPairQuestions };
    }
  }

  if (Object.keys(currentBatch).length > 0) {
    batches.push(currentBatch);
  }

  // 3. Execute DecisionBackend requests in parallel
  const responses: DecisionResponse[] = await Promise.all(
    batches.map((batch) => backend.ask(fitted.state, batch))
  );

  // Combine answers across responses
  const combinedAnswers: Record<string, any> = {};
  for (const resp of responses) {
    if (resp?.answers) {
      Object.assign(combinedAnswers, resp.answers);
    }
  }

  const unifiedResponse: DecisionResponse = {
    answers: combinedAnswers,
  };

  // 4. Convert answers into CallDecisions
  const decisions: CallDecision[] = [];

  for (const call of calls) {
    if (call.pinned) {
      decisions.push({
        id: call.id,
        tool: call.tool,
        keepCall: 1,
        keepResult: 1,
        action: 'keep',
        reason: 'pinned',
      });
      continue;
    }

    const callQId = `call_${call.id}`;
    const resultQId = `result_${call.id}`;

    let keepCall = 1;
    let keepResult = 1;

    try {
      const callAns = getNoulAnswer(unifiedResponse, callQId);
      keepCall = callAns.noul;
    } catch {
      // Missing model answer -> default conservatively to keepCall = 1
      keepCall = 1;
    }

    try {
      const resultAns = getNoulAnswer(unifiedResponse, resultQId);
      keepResult = resultAns.noul;
    } catch {
      // Missing model answer -> default conservatively to keepResult = 1
      keepResult = 1;
    }

    let action: CallAction;
    let reason: DecisionReason;

    if (keepResult >= resolved.keepThreshold) {
      action = 'keep';
      reason = 'kept';
    } else if (keepCall >= resolved.keepThreshold) {
      action = 'drop_result';
      reason = 'result_dropped';
    } else {
      action = 'drop_call';
      reason = 'call_dropped';
    }

    decisions.push({
      id: call.id,
      tool: call.tool,
      keepCall,
      keepResult,
      action,
      reason,
    });
  }

  // 5. Apply decisions to transcript
  const compactedMessages = applyDecisions(
    messages,
    decisions,
    calls,
    resolved.truncateHeadChars
  );

  const charsAfter = calculateTranscriptChars(compactedMessages);
  const kept = decisions.filter((d) => d.action === 'keep').length;
  const resultsDropped = decisions.filter((d) => d.action === 'drop_result').length;
  const callsDropped = decisions.filter((d) => d.action === 'drop_call').length;

  return {
    messages: compactedMessages,
    decisions,
    stats: {
      messagesBefore: messages.length,
      messagesAfter: compactedMessages.length,
      charsBefore,
      charsAfter,
      calls: calls.length,
      kept,
      resultsDropped,
      callsDropped,
      pinned: pinnedCalls.length,
      stateTokens,
      stateStage,
      requests: batches.length,
      ms: Date.now() - startTime,
    },
  };
}
