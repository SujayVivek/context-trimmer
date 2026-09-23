/**
 * Role of a message participant.
 */
export type Role = 'user' | 'assistant';

/**
 * Represents a tool use invocation initiated by the assistant.
 */
export interface ToolUse {
  tool_use_id: string;
  tool: string;
  input: Record<string, unknown>;
  text?: string;
  isError?: boolean;
}

/**
 * Represents the output/result of a tool execution.
 */
export interface ToolResult {
  tool_use_id: string;
  text: string;
  isError?: boolean;
}

/**
 * Represents a message within the transcript.
 */
export interface Message {
  role: Role;
  text: string;
  toolUses?: ToolUse[];
  toolResults?: ToolResult[];
}

/**
 * Represents a paired tool invocation and result with metadata used for compaction decisions.
 */
export interface ToolCall {
  /** Internal identifier (e.g., 't1', 't2', 't3') */
  id: string;
  tool_use_id: string;
  tool: string;
  input: Record<string, unknown>;
  callIndex: number;
  resultIndex?: number;
  resultChars: number;
  isError: boolean;
  pinned: boolean;
}
