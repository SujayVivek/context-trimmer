# ContextSieve

**ContextSieve** is a model-independent context-trimming and compaction library designed for AI coding assistant conversation histories.

Its goal is to intelligently reduce context size by evaluating which historical tool calls and results remain relevant, while preserving original transcript integrity wherever possible.

---

## Core Architecture & Principles

### 1. Model-Independent Compaction Engine
ContextSieve cleanly decouples compaction logic from decision backends. Whether decisions are made by Jev, Laya, OpenAI, or local models, the core compaction engine interacts strictly with model-independent interfaces (`DecisionBackend`).

### 2. Strict Architectural Separation
1. **State Preparation**: Preparing a compact representation (`CompactionState`) of conversation history to present to the decision model.
2. **Decision Application**: Applying structured decisions (`DecisionAnswer[]`) to the original transcript (`Transcript`) via `CompactionEngine`. The original transcript remains untouched until decisions are applied.

---

## Core Data Model

- **`Message`**: Represents user or assistant chat turns with optional `toolUses` and `toolResults`.
- **`ToolUse`**: Captures tool invocation requests issued by the assistant (`tool_use_id`, `tool`, `input`).
- **`ToolResult`**: Captures output/results returned from tool executions.
- **`ToolCall`**: Pairs a tool invocation (`ToolUse`) with its result (`ToolResult`) alongside compaction metadata (`callIndex`, `resultChars`, `pinned`, etc.).

---

## Directory Structure

```
src/
├── types/          # Core conceptual data models (Message, ToolUse, ToolResult, ToolCall)
├── transcript/     # Original transcript abstraction & immutability helpers
├── state/          # Compact state representations for decision backend input
├── decisions/      # Model-independent DecisionBackend interface & decision types
├── compaction/     # CompactionEngine contracts for applying decisions
└── index.ts        # Primary package entrypoint re-exporting clean abstractions

tests/              # Vitest test suite & smoke tests
```

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Build
```bash
npm install
npm run build
```

### Run Tests
```bash
npm test
```
