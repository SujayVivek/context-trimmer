import type { Message, ToolCall, ToolResult } from '../types/index.js';

/**
 * Container for the original transcript preserving conversation integrity.
 */
export interface Transcript {
  readonly messages: readonly Message[];
}

/**
 * Helper to wrap a set of messages into a Transcript structure.
 */
export function createTranscript(messages: Message[]): Transcript {
  return {
    messages: Object.freeze([...messages]),
  };
}

/**
 * Determines whether a message at a given index is pinned.
 * A message is pinned if:
 * 1. It is the first message (index === 0).
 * 2. It falls within the newest `preserveRecentMessages` (index >= totalMessages - preserveRecentMessages).
 *
 * @param index The 0-based message index.
 * @param totalMessages Total count of messages in the transcript.
 * @param preserveRecentMessages Number of recent messages to preserve.
 */
export function isPinned(
  index: number,
  totalMessages: number,
  preserveRecentMessages: number
): boolean {
  if (index === 0) {
    return true;
  }
  if (preserveRecentMessages <= 0 || totalMessages <= 0) {
    return false;
  }
  const recentThreshold = totalMessages - preserveRecentMessages;
  return index >= recentThreshold;
}

interface ToolResultInfo {
  result: ToolResult;
  resultIndex: number;
}

/**
 * Collects and pairs ToolUse invocations with their corresponding ToolResult items across a transcript,
 * generating sequential ToolCall metadata objects.
 *
 * @param messages Array of messages in the transcript.
 * @param preserveRecentMessages Count of recent messages to automatically pin.
 * @returns Array of paired ToolCall metadata.
 */
export function collectToolCalls(
  messages: readonly Message[],
  preserveRecentMessages: number
): ToolCall[] {
  const totalMessages = messages.length;
  const resultMap = new Map<string, ToolResultInfo>();

  // 1. Index all tool results by tool_use_id
  for (let i = 0; i < totalMessages; i++) {
    const msg = messages[i];
    if (msg?.toolResults) {
      for (const res of msg.toolResults) {
        if (res?.tool_use_id) {
          resultMap.set(res.tool_use_id, {
            result: res,
            resultIndex: i,
          });
        }
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  let counter = 1;

  // 2. Iterate through messages and collect paired tool calls
  for (let callIndex = 0; callIndex < totalMessages; callIndex++) {
    const msg = messages[callIndex];
    if (msg?.toolUses) {
      for (const use of msg.toolUses) {
        const found = resultMap.get(use.tool_use_id);
        if (!found) {
          // If there is no corresponding result, do NOT include as compaction candidate
          continue;
        }

        const pinned =
          isPinned(callIndex, totalMessages, preserveRecentMessages) ||
          isPinned(found.resultIndex, totalMessages, preserveRecentMessages);

        toolCalls.push({
          id: `t${counter++}`,
          tool_use_id: use.tool_use_id,
          tool: use.tool,
          input: use.input,
          callIndex,
          resultIndex: found.resultIndex,
          resultChars: found.result.text ? found.result.text.length : 0,
          isError: found.result.isError ?? false,
          pinned,
        });
      }
    }
  }

  return toolCalls;
}

