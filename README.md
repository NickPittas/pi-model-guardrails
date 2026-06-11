# pi-model-guardrails v2.0

Automatic model-specific guardrails for [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Detects which LLM is active and which agent role is running, then injects optimal thinking budgets, reasoning format, temperature, and output discipline — transparently.

## What It Does

### Extension (automatic on every LLM call)
- **Model detection**: Identifies Gemma 4, Qwen 3.6 (Dense/MoE) by model name pattern
- **Tiered thinking budgets**: Per-agent-role reasoning token allocation (max/high/medium/low/none)
- **Per-model numeric budgets**: Same tier maps to different token counts per model family
- **Reasoning format**: Automatically passes `reasoning_format: "deepseek"` for Qwen models (required for `thinking_budget_tokens` enforcement)
- **Temperature tuning**: Gemma 0.7, Qwen 0.6
- **Output discipline**: Prepends guardrails against repetition, summaries-instead-of-code, and incomplete output

### Agents (8 specialized roles)

| Agent | Tier | Best For |
|-------|:----:|----------|
| `gemma-architect` | max | System design, multi-step planning |
| `gemma-debugger` | high | Bug hunting, error tracing |
| `gemma-reviewer` | high | Code review, quality audit |
| `gemma-algo-solver` | high | Algorithms, optimization |
| `gemma-general` | medium | Analysis, instructions, mixed tasks |
| `gemma-polyglot` | low | Multi-language translation |
| `gemma-code-gen` | low | Code generation, refactoring |
| `iterative-auditor` | max | Multi-pass bug hunting with PRD scrutiny |

### Smart Tools (all agents)
Every agent has optimized file navigation:
- `ffgrep`, `fffind` — fast code search
- `codemap_locate`, `codemap_context` — semantic code location
- `lsp_diagnostics`, `lsp_navigation` — IDE-quality type checking and navigation
- `ast_grep_search`, `ast_grep_replace` — structural code search and replace

Plus strict navigation rules: always use smart tools before `read`, never read more than 50 lines at a time.

## Install

```bash
pi install git:github.com/NickPittas/pi-model-guardrails
/reload
```

Extension and agents auto-install. Works with any llama.cpp server.

## Usage

```bash
# 1. Load your model on the server
curl -s http://your-server:8080/models/load \
  -X POST -H "Content-Type: application/json" \
  -d '{"model": "your-model-name"}'

# 2. Select the model in pi (/:model or /model)

# 3. Use a guardrail agent
subagent(agent="gemma-debugger", model="your-model", task="Find bugs in ...")
```

The extension detects the model and agent role automatically — no manual configuration needed.

## How It Works

### Tiered Budget System

Instead of hardcoding token counts per agent (which would be wrong for every model), the system has two layers:

1. **Agent → Tier**: Each agent role maps to a tier (max/high/medium/low/none)
2. **Model × Tier → Tokens**: Each model family defines its own token budget per tier

Example:
```
Agent: gemma-debugger → Tier: "high"
Model: Qwen 35B MoE → Tier "high" = 2048 tokens
Model: Gemma 12B   → Tier "high" = 512 tokens
```

This means the same agent config works optimally across all models.

### Thinking Mode

| Mode | Models | Mechanism |
|------|--------|-----------|
| `budget` | Gemma | `thinking_budget_tokens` (native) |
| `chat_template_budget` | Qwen | `reasoning_format: "deepseek"` + `thinking_budget_tokens` + `chat_template_kwargs.enable_thinking` |

For Qwen models, `reasoning_format: "deepseek"` is **required** — without it, `thinking_budget_tokens` is silently ignored by llama.cpp.

## Tested Models

| Model | Quant | Size | Context | TPS | Quality Score |
|-------|-------|------|---------|-----|:------------:|
| Qwen 3.6 35B MoE | Compact | 18GB | 131K | 250 | 9.3 |
| Qwen 3.6 27B Dense | Q5_K_M | 19.8GB | 131K | 65 | 9.3 |
| Gemma 4 12B | Q8_0 | 12.7GB | 131K | 90 | 8.2 |

Scores from 13-test evaluation suite + hard test suite (multi-file bug hunting, refactoring, logic bugs). See [evaluation details](https://github.com/NickPittas/pi-model-guardrails#evaluation).

## Changelog

### v2.0.0
- **Tiered budget system**: Per-agent-role tier with per-model numeric budgets (replaces flat per-agent token counts)
- **`chat_template_budget` mode**: `reasoning_format: "deepseek"` + budget enforcement for Qwen
- **Smart tools in all agents**: ffgrep, fffind, codemap, LSP diagnostics/navigation, ast-grep
- **Strict navigation rules**: Always use smart tools before read, never read >50 lines
- **New agent**: `iterative-auditor` — multi-pass PRD-driven bug hunting (87% recall)
- **Agents auto-install**: `package.json` now includes `"agents": ["./agents"]`

### v1.0.0
- Initial release with flat per-agent thinking budgets
- 7 guardrail agents
- Gemma `budget` mode and Qwen `chat_template` mode

## License

MIT
