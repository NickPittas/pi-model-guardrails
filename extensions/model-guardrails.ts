import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

export default function (pi: ExtensionAPI) {
  // ── Configuration ──

  // How thinking/reasoning is controlled for a model family.
  // "budget" = llama.cpp thinking_budget_tokens (Gemma-style)
  // "chat_template_budget" = Qwen-style: reasoning_format=deepseek + thinking_budget_tokens + chat_template_kwargs
  type ThinkingMode = "budget" | "chat_template_budget";

  interface ModelConfig {
    guardrail?: string;
    temperature?: number;
    maxTokens?: number;
    // How to control reasoning for this model family.
    thinkingMode: ThinkingMode;
    // Default reasoning token budget (applies to both modes).
    defaultThinkingBudget?: number;
    // Per-tier token budgets. Maps tier name to token count.
    // -1 = unlimited. Required for chat_template_budget mode.
    budgetTiers?: Record<string, number>;
  }

  // Per-agent thinking budget tiers.
  // "max" = unlimited reasoning (planning, complex architecture)
  // "high" = deep reasoning (review, debugging, security)
  // "medium" = balanced (general tasks, refactoring)
  // "low" = brief (code gen, polyglot translation)
  // "none" = no reasoning (search, explore, simple execution)
  //
  // The numeric budget is applied per model family via BUDGET_TIERS.
  type BudgetTier = "max" | "high" | "medium" | "low" | "none";

  const AGENT_BUDGET_TIER: Record<string, BudgetTier> = {
    // Max reasoning — planning and complex multi-step analysis
    "planner": "max",
    "architect": "max",
    "iterative": "max",

    // High reasoning — deep analysis where quality matters most
    "debugger": "high",
    "security": "high",
    "algo-solver": "high",
    "reviewer": "high",
    "auditor": "high",

    // Medium — balanced tasks
    "general": "medium",
    "refactor": "medium",

    // Low — volume tasks, reasoning minimal
    "code-gen": "low",
    "polyglot": "low",

    // No reasoning — search, explore, simple execution
    "search": "none",
    "explore": "none",
    "library": "none",
    "scout": "none",
  };

  const DEFAULT_BUDGET_TIER: BudgetTier = "medium"; // Safe default for unknown agents

  const MODEL_CONFIGS: Record<string, ModelConfig> = {
    "gemma-4-12b": {
      temperature: 0.7,
      thinkingMode: "budget",
      defaultThinkingBudget: 0,

      budgetTiers: {
        max: 1024,   // Gemma 12B is smaller — cap even max tasks
        high: 512,   // deep analysis
        medium: 256, // balanced
        low: 64,     // brief
        none: 0,     // no reasoning
      } as Record<BudgetTier, number>,

      guardrail: `You are a precise, thorough coding assistant.

OUTPUT DISCIPLINE:
1. When asked to write code, produce COMPLETE, runnable code — not snippets, not placeholders, not "// rest of implementation here".
2. When asked to find bugs, list the bugs AND provide the full fixed code. Do not stop at just the list.
3. When asked to review code, provide findings AND a refactored version. Not one or the other.
4. When asked for multiple things (languages, problems, sections), complete EACH one fully. Do not skip items.
5. Do NOT use "...", "omitted for brevity", or "as shown above" as substitutes for actual output.
6. If you realize you're about to output the same character or line repeatedly, STOP and produce different content.
7. Do not include any internal reasoning, thought blocks, or "Let me think about this" preamble. Go directly to the output.

STYLE:
- Follow the exact output format the user requests.
- When no format is specified, use clear markdown with headers and code blocks.
- Prefer producing the actual content over describing what you would produce.`,
    },
    "qwen3.6": {
      temperature: 0.6,
      thinkingMode: "chat_template_budget",
      defaultThinkingBudget: 0,

      // Per-tier token budgets for Qwen models.
      // These work because we pass reasoning_format="deepseek" which
      // gives the server start/end tags to enforce the budget.
      budgetTiers: {
        max: -1,     // unlimited — let the model reason fully
        high: 2048,  // deep analysis — bug hunting, security audit
        medium: 1024, // balanced — general coding tasks
        low: 512,    // brief — code gen, translation
        none: 0,     // no reasoning — search, explore
      } as Record<BudgetTier, number>,

      guardrail: `You are a precise, thorough coding assistant.

OUTPUT DISCIPLINE:
1. When asked to write code, produce COMPLETE, runnable code — not snippets, not placeholders, not "// rest of code here".
2. When asked to find bugs, list the bugs AND provide the full fixed code. Do not stop at just the list.
3. When asked to review code, provide findings AND a refactored version. Not one or the other.
4. When asked for multiple things (languages, problems, sections), complete EACH one fully. Do not skip items.
5. Do NOT use "...", "omitted for brevity", or "as shown above" as substitutes for actual output.
6. If you realize you're about to output the same character or line repeatedly, STOP and produce different content.

STYLE:
- Follow the exact output format the user requests.
- When no format is specified, use clear markdown with headers and code blocks.
- Prefer producing the actual content over describing what you would produce.`,
    },
  };

  // ── State ──
  let currentModelId: string | undefined;
  let currentTier: BudgetTier = DEFAULT_BUDGET_TIER;

  pi.on("model_select", async (event, _ctx) => {
    currentModelId = event.model.id.toLowerCase();
  });

  // ── Resolve model config ──
  function getModelConfig(): ModelConfig | undefined {
    if (!currentModelId) return undefined;
    for (const [pattern, config] of Object.entries(MODEL_CONFIGS)) {
      if (currentModelId.includes(pattern.toLowerCase())) {
        return config;
      }
    }
    return undefined;
  }

  // ── Detect agent type from system prompt and set thinking tier ──
  pi.on("before_agent_start", async (event, _ctx) => {
    const config = getModelConfig();
    if (!config) return;

    // Detect which agent is running by checking the system prompt
    const prompt = (event.systemPrompt || "").toLowerCase();
    let detectedTier: BudgetTier = DEFAULT_BUDGET_TIER;
    for (const [substring, tier] of Object.entries(AGENT_BUDGET_TIER)) {
      if (prompt.includes(substring.toLowerCase())) {
        detectedTier = tier;
        break;
      }
    }
    currentTier = detectedTier;

    if (config.guardrail) {
      return {
        systemPrompt: config.guardrail + "\n\n" + event.systemPrompt,
      };
    }
  });

  // ── Inject generation settings into API request ──
  pi.on("before_provider_request", (event, _ctx) => {
    const config = getModelConfig();
    if (!config) return;

    const payload = event.payload as Record<string, unknown>;
    let modified = false;

    if (config.temperature !== undefined) {
      payload.temperature = config.temperature;
      modified = true;
    }

    if (config.maxTokens !== undefined) {
      payload.max_tokens = config.maxTokens;
      modified = true;
    }

    // Resolve numeric budget from tier
    const tiers = config.budgetTiers;
    let budget: number;
    if (tiers && currentTier in tiers) {
      budget = tiers[currentTier];
    } else {
      budget = config.defaultThinkingBudget ?? 0;
    }

    // Inject thinking/reasoning control based on model family
    if (config.thinkingMode === "budget") {
      // Gemma-style: llama.cpp thinking_budget_tokens + reasoning_control
      payload.thinking_budget_tokens = budget;
      payload.reasoning_control = true;
      modified = true;
    } else if (config.thinkingMode === "chat_template_budget") {
      // Qwen-style: reasoning_format=deepseek enables thinking_budget_tokens
      // AND chat_template_kwargs.enable_thinking controls the template.
      // Both must work together for budget enforcement.
      payload.reasoning_format = "deepseek";
      payload.thinking_budget_tokens = budget;
      payload.reasoning_control = true;

      const enableThinking = budget !== 0;
      const existingKwargs = (payload.chat_template_kwargs || {}) as Record<string, unknown>;
      existingKwargs.enable_thinking = enableThinking;
      payload.chat_template_kwargs = existingKwargs;
      modified = true;
    }

    if (modified) return payload;
  });

  // ── Agent installer ──
  pi.on("session_start", async (event, _ctx) => {
    if (event.reason !== "startup" && event.reason !== "reload") return;

    const agentsDir = path.join(
      process.env.HOME || "/tmp",
      ".pi",
      "agent",
      "agents"
    );
    const packageAgentsDir = path.resolve(__dirname, "..", "agents");

    if (!fs.existsSync(packageAgentsDir)) return;
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    const agentFiles = fs
      .readdirSync(packageAgentsDir)
      .filter((f) => f.endsWith(".md"));

    let installed = 0;
    for (const file of agentFiles) {
      const targetName = `delegate.${file}`;
      const targetPath = path.join(agentsDir, targetName);

      if (fs.existsSync(targetPath)) continue;

      const sourcePath = path.join(packageAgentsDir, file);
      fs.copyFileSync(sourcePath, targetPath);
      installed++;
    }

    if (installed > 0) {
      pi.log?.(`model-guardrails: installed ${installed} agent config(s)`);
    }
  });
}
