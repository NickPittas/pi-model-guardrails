# pi-model-guardrails

Automatically injects model-specific guardrails when using smaller or local models with [pi](https://pi.dev).

## The Problem

Small local models (like Gemma 4 12B) are surprisingly capable, but they have **output discipline issues**:

- They summarize instead of producing actual code
- They reason extensively but forget to output the result
- They truncate or use "..." instead of writing complete code
- They can get stuck in repetition loops

These aren't capability problems — the model *can* do the work. It just needs the right nudges.

## The Solution

This pi extension listens to `model_select` events and automatically prepends a tailored system prompt when a matching model is active. No manual steps — just select your model with `/model` and the guardrails are applied.

## What the Guardrails Do

- **Encourage reasoning** — explicitly tells the model to think about approach, edge cases, and correctness (this is a strength, not a weakness)
- **Require concrete output** — after reasoning, always produce the actual artifact (code, analysis, etc.)
- **Prevent truncation** — no "...", "omitted for brevity", or placeholder comments
- **Prevent repetition** — detect and break out of character/line repetition loops
- **Enforce completeness** — when asked for N things, produce all N

## Supported Models

| Model ID Pattern | Guardrail |
|------------------|-----------|
| `gemma-4-12b` | General output discipline + reasoning guidance |

Adding more models is easy — just add an entry to the `GUARDRAILS` object in `extensions/model-guardrails.ts`.

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

Just use your model normally. The guardrails are injected automatically.

```bash
# In pi TUI:
/model          # Select gemma-4-12b-it
# Guardrails are now active for every prompt
```

## Adding Custom Models

Edit `extensions/model-guardrails.ts` and add a new entry:

```typescript
const GUARDRAILS: Record<string, string> = {
  "gemma-4-12b": `... existing guardrail ...`,

  "my-custom-model": `Your guardrail text here.
OUTPUT DISCIPLINE:
1. ...
2. ...

REASONING GUIDANCE:
- DO reason about ...
- DO NOT ...`,
};
```

The key is a **substring match** against the lowercase model ID. So `"gemma-4-12b"` matches `gemma-4-12b-it-Q8_0`.

## How It Works

1. On `model_select` → tracks the active model ID
2. On `before_agent_start` → checks if the active model matches a guardrail pattern
3. If matched → prepends the guardrail text to the system prompt

## Companion: Subagent Guardrails

For delegated subagent tasks, this repo also includes task-specific agent configs that you can copy to `~/.pi/agent/agents/`:

| Agent | Use Case |
|-------|----------|
| `gemma-debugger` | Forces full bug list + complete fixed code |
| `gemma-reviewer` | Forces findings + refactored code, anti-repetition |
| `gemma-algo-solver` | Forces approach + code + test cases per problem |
| `gemma-polyglot` | Forces complete code in every language |
| `gemma-architect` | Forces full specs, code, schema |

Usage:
```bash
pi subagent delegate.gemma-debugger --model llama-mustafar/gemma-4-12b-it-Q8_0 --task "Find bugs in this code: ..."
```

## License

MIT
