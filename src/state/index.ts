import type { Message, ToolCall, Role } from '../types/index.js';
import { isPinned } from '../transcript/index.js';

/**
 * Compact representation of a tool call within a history entry.
 */
export interface HistoryToolCall {
  id: string;
  tool: string;
  input: string;
  result: string;
}

/**
 * Historical conversation turn entry prepared for the decision model.
 */
export interface HistoryEntry {
  /** Original message index */
  i: number;
  role: Role;
  text: string;
  tool_calls?: HistoryToolCall[];
}

/**
 * Compact conversation state sent to decision models.
 */
export interface CompactionState {
  context: string;
  goal: string;
  history: HistoryEntry[];
}

/**
 * Result of state fitting against a token budget.
 */
export interface FittedState {
  state: CompactionState;
  tokens: number;
  stage: string;
}

/**
 * Options for state fitting.
 */
export interface FitStateOptions {
  maxTokens: number;
  goal?: string;
  preserveRecentMessages?: number;
}

/**
 * Context instruction explaining the state format and purpose to decision models.
 */
export const STATE_CONTEXT_INSTRUCTION =
  'This is an AI coding assistant conversation transcript prepared for compaction decisions. ' +
  'History entries are ordered oldest-first. Tool outputs are represented by compact result notes rather than full contents. ' +
  'Questions will evaluate whether a tool call or its detailed output remains necessary. ' +
  'Omitted tool details can be recovered if needed by re-running tools or re-reading workspace files.';

/**
 * Deterministic conservative heuristic for estimating token count from text.
 * Uses a conservative ratio (~3 characters per token) to avoid underestimating token usage.
 * Note: This is an approximation and can later be replaced with a model-specific tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

/**
 * Truncates text to a specified character limit, appending an indicator if truncated.
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const suffix = '... [truncated]';
  if (limit <= suffix.length) {
    return text.slice(0, limit);
  }
  return text.slice(0, limit - suffix.length) + suffix;
}

/**
 * Derives a conversation goal from up to 3 recent user messages,
 * ignoring user messages that contain only tool results.
 */
export function goalFromMessages(messages: readonly Message[]): string {
  const meaningfulUserMsgs: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;

    // Ignore user messages that contain only tool results with no text
    const hasOnlyToolResults =
      Boolean(msg.toolResults && msg.toolResults.length > 0) &&
      (!msg.text || msg.text.trim().length === 0);

    if (hasOnlyToolResults) {
      continue;
    }

    const cleanText = msg.text ? msg.text.trim() : '';
    if (cleanText.length > 0) {
      // Limit size of each user message so large prompts do not dominate
      const truncated = truncate(cleanText, 300);
      meaningfulUserMsgs.unshift(truncated);
    }

    if (meaningfulUserMsgs.length >= 3) {
      break;
    }
  }

  if (meaningfulUserMsgs.length === 0) {
    return 'No explicit user goal identified.';
  }

  return meaningfulUserMsgs.join('\n---\n');
}

/**
 * Format a tool result note.
 */
function formatResultNote(call: ToolCall): string {
  return call.isError
    ? `error, ${call.resultChars} chars (omitted)`
    : `ok, ${call.resultChars} chars (omitted)`;
}

/**
 * Serialize tool input object to string with length limit.
 */
function formatToolInput(input: Record<string, unknown>, limit: number): string {
  try {
    const json = JSON.stringify(input);
    return truncate(json, limit);
  } catch {
    return truncate(String(input), limit);
  }
}

/**
 * Build history entries for a specific stage.
 */
function buildHistoryEntries(
  messages: readonly Message[],
  calls: readonly ToolCall[],
  stage: string,
  preserveRecentMessages: number
): HistoryEntry[] {
  const totalMessages = messages.length;

  // Map tool calls by callIndex
  const callsByMessageIndex = new Map<number, ToolCall[]>();
  for (const call of calls) {
    const existing = callsByMessageIndex.get(call.callIndex) || [];
    existing.push(call);
    callsByMessageIndex.set(call.callIndex, existing);
  }

  const history: HistoryEntry[] = [];

  for (let i = 0; i < totalMessages; i++) {
    const msg = messages[i];
    if (!msg) continue;

    const pinned = isPinned(i, totalMessages, preserveRecentMessages);
    const msgCalls = callsByMessageIndex.get(i) || [];

    // Determine input limit based on stage and pinned status
    let inputLimit = 500;
    if (stage === 'stage2') {
      inputLimit = pinned ? 300 : 100;
    } else if (stage === 'stage3') {
      inputLimit = pinned ? 200 : 80;
    } else if (stage === 'stage4') {
      inputLimit = pinned ? 150 : 50;
    } else if (stage === 'stage5' || stage === 'stage6' || stage === 'stage7') {
      inputLimit = pinned ? 100 : 30;
    }

    const historyToolCalls: HistoryToolCall[] = msgCalls.map((c) => ({
      id: c.id,
      tool: c.tool,
      input: formatToolInput(c.input, inputLimit),
      result: formatResultNote(c),
    }));

    let text = msg.text || '';

    // Stage-specific text transformations
    if (!pinned) {
      if (stage === 'stage3') {
        // Stage 3: Abridge long conversational text
        if (text.length > 200) {
          const omittedCount = text.length - 200;
          text = `${text.slice(0, 100)}\n... [omitted ${omittedCount} chars] ...\n${text.slice(-100)}`;
        }
      } else if (stage === 'stage4' || stage === 'stage5' || stage === 'stage6' || stage === 'stage7') {
        // Stage 4+: Collapse older conversational text
        text = text.trim().length > 0 ? '[conversational text omitted]' : '';
      }
    }

    // Stage 6: Remove old messages that contain no tool calls and omitted text
    if ((stage === 'stage6' || stage === 'stage7') && !pinned) {
      const hasNoToolCalls = historyToolCalls.length === 0;
      const isOmittedText = text === '[conversational text omitted]' || text === '';
      if (hasNoToolCalls && isOmittedText) {
        continue;
      }
    }

    const entry: HistoryEntry = {
      i,
      role: msg.role,
      text,
    };

    if (historyToolCalls.length > 0) {
      entry.tool_calls = historyToolCalls;
    }

    history.push(entry);
  }

  // Stage 7: Merge adjacent old call-only history entries if needed
  if (stage === 'stage7') {
    const mergedHistory: HistoryEntry[] = [];
    for (const entry of history) {
      const isUnpinnedCallOnly =
        !isPinned(entry.i, totalMessages, preserveRecentMessages) &&
        entry.text === '[conversational text omitted]' &&
        Boolean(entry.tool_calls && entry.tool_calls.length > 0);

      const prev = mergedHistory[mergedHistory.length - 1];
      const prevIsUnpinnedCallOnly =
        prev &&
        !isPinned(prev.i, totalMessages, preserveRecentMessages) &&
        prev.text === '[conversational text omitted]' &&
        Boolean(prev.tool_calls && prev.tool_calls.length > 0);

      if (isUnpinnedCallOnly && prevIsUnpinnedCallOnly && prev && prev.tool_calls && entry.tool_calls) {
        // Merge tool calls into previous entry
        prev.tool_calls.push(...entry.tool_calls);
      } else {
        mergedHistory.push(entry);
      }
    }
    return mergedHistory;
  }

  return history;
}

/**
 * Creates a CompactionState representation without state fitting.
 */
export function createCompactionState(
  messages: readonly Message[],
  calls: readonly ToolCall[],
  goal?: string,
  preserveRecentMessages: number = 2
): CompactionState {
  const goalText = goal || goalFromMessages(messages);
  const history = buildHistoryEntries(messages, calls, 'stage1', preserveRecentMessages);
  return {
    context: STATE_CONTEXT_INSTRUCTION,
    goal: goalText,
    history,
  };
}

/**
 * Progressive state fitting algorithm to shrink CompactionState until it fits maxTokens budget.
 */
export function fitState(
  messages: readonly Message[],
  calls: readonly ToolCall[],
  options: FitStateOptions
): FittedState {
  const { maxTokens, goal, preserveRecentMessages = 2 } = options;
  const goalText = goal || goalFromMessages(messages);

  const stages = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7'];

  for (const stage of stages) {
    const history = buildHistoryEntries(messages, calls, stage, preserveRecentMessages);
    const state: CompactionState = {
      context: STATE_CONTEXT_INSTRUCTION,
      goal: goalText,
      history,
    };

    const tokens = estimateTokens(JSON.stringify(state));
    if (tokens <= maxTokens) {
      return {
        state,
        tokens,
        stage,
      };
    }
  }

  throw new Error(`Unable to fit compaction state within token limit of ${maxTokens}.`);
}
