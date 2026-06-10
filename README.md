# pi-model-guardrails

Automatically injects model-specific guardrails, temperature, and generation settings when using smaller or local models with [pi](https://pi.dev).

## The Problem

Small local models (like Gemma 4 12B) are surprisingly capable, but they have **output discipline issues**:

- They summarize instead of producing actual code
- They reason extensively but forget to output the result
- They truncate or use "..." instead of writing complete code
- They can get stuck in repetition loops
- High temperature makes them reason *too much*, burning output tokens

These aren't capability problems — the model *can* do the work. It just needs the right settings and nudges.

## The Solution

This pi extension hooks into three events:

1. **`model_select`** — tracks which model is active
2. **`before_agent_start`** — injects a guardrail system prompt tailored to the model
3. **`before_provider_request`** — overrides temperature and max_tokens per model

No manual steps — just select your model with `/model` and everything is applied automatically.

## What Gets Injected

### Guardrails (system prompt)
- **Encourages reasoning** — explicitly tells the model to think about approach, edge cases, and correctness
- **Requires concrete output** — after reasoning, always produce the actual artifact
- **Prevents truncation** — no "...", "omitted for brevity", or placeholder comments
- **Prevents repetition** — detect and break out of character/line repetition loops

### Reasoning strategy

Reasoning is the model's **biggest strength** — but it burns output tokens. The extension automatically adjusts `reasoning_effort` based on which agent is running:

| Task Type | Reasoning | Why |
|-----------|-----------|-----|
| Debugging (`gemma-debugger`) | `high` | Must trace logic, find edge cases, reason about each bug |
| Security audit | `high` | Must reason about attack vectors, chaining, severity |
| Algorithms (`gemma-algo-solver`) | `high` | Must reason about correctness, complexity, edge cases |
| Code review (`gemma-reviewer`) | `medium` | Needs to understand code deeply, but output is priority |
| Refactoring | `medium` | Needs to understand before/after, but output is priority |
| Multi-language (`gemma-polyglot`) | `low` | Volume task — 5-8 complete implementations needed |
| API design (`gemma-architect`) | `low` | Volume task — YAML + SQL + code + examples |
| Code generation | `low` | Just needs to write — reasoning wastes tokens |
| **Default (direct `/model` use)** | **`none`** | **Safe default — all tokens go to content** |

The detection works by inspecting the system prompt for agent-identifying substrings (e.g. "debugger", "reviewer", "polyglot").

### Generation settings

| Model | Temperature | Default Reasoning |
|-------|-------------|-------------------|
| `gemma-4-12b` | 0.7 | `none` (overridden per-agent as above) |

Settings are injected per-request via `before_provider_request`. Accepted reasoning values: `"none"`, `"low"`, `"medium"`, `"high"`.

Note: the server may still produce some internal reasoning regardless — the `--reasoning on` flag at the server level can't be fully overridden by the API. The guardrail prompt instruction reinforces the no-reasoning behavior in the model's output text.

### Why temperature control matters
At temp 1.5, Gemma 4 12B produces verbose reasoning that can consume the entire output budget before producing content. At temp 0.7, it reasons more concisely and reliably produces the actual output. The extension lets you keep the server at 1.5 for interactive exploration while automatically lowering it for structured tasks.

## Supported Models

| Model ID Pattern | Temperature | Guardrail |
|------------------|-------------|-----------|
| `gemma-4-12b` | 0.7 | Output discipline + reasoning guidance |

Adding more models is easy — just add an entry to `MODEL_CONFIGS` in `extensions/model-guardrails.ts`.

## Installation

### Via pi install (recommended)

```bash
pi install git:github.com/NickPittas/pi-model-guardrails
```

### Via settings.json

```json
{
  "packages": ["git:github.com/NickPittas/pi-model-guardrails"]
}
```

### Local development

```bash
pi install /path/to/pi-model-guardrails
```

## Usage

Just use your model normally. Everything is injected automatically.

```bash
# In pi TUI:
/model          # Select gemma-4-12b-it
# Guardrails + temperature override are now active
```

## Adding Custom Models

Edit `extensions/model-guardrails.ts`:

```typescript
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gemma-4-12b": {
    temperature: 0.7,
    guardrail: `... existing guardrail ...`,
  },

  "my-custom-model": {
    temperature: 0.5,
    maxTokens: 8192,
    guardrail: `Your guardrail text here.
OUTPUT DISCIPLINE:
1. ...
REASONING GUIDANCE:
- DO reason about ...
- DO NOT ...`,
  },
};
```

The key is a **substring match** against the lowercase model ID. So `"gemma-4-12b"` matches `gemma-4-12b-it-Q8_0`.

Set any field to `undefined` to skip that override.

## Companion: Subagent Guardrails

This package also includes task-specific agent configs. They are **automatically installed** to `~/.pi/agent/agents/` on first startup — no manual setup needed.

| Agent | Use Case |
|-------|----------|
| `delegate.gemma-debugger` | Forces full bug list + complete fixed code |
| `delegate.gemma-reviewer` | Forces findings + refactored code, anti-repetition |
| `delegate.gemma-algo-solver` | Forces approach + code + test cases per problem |
| `delegate.gemma-polyglot` | Forces complete code in every language |
| `delegate.gemma-architect` | Forces full specs, code, schema |

Already-existing agent files are never overwritten, so you can safely customize them after installation.

Usage:
```bash
pi subagent delegate.gemma-debugger --model llama-mustafar/gemma-4-12b-it-Q8_0 --task "Find bugs in this code: ..."
```

## How It Works

1. On `model_select` → tracks the active model ID
2. On `before_agent_start` → prepends guardrail text to the system prompt
3. On `before_provider_request` → injects `temperature`, `reasoning_effort`, and `max_tokens` into the API payload

## License

MIT
