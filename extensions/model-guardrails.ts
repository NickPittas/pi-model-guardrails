import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

type ThinkingMode = "budget" | "chat_template_budget";
type BudgetTier = "max" | "high" | "medium" | "low" | "none";

type ModelConfig = {
  guardrail: string;
  temperature?: number;
  maxTokens?: number;
  thinkingMode?: ThinkingMode;
  defaultThinkingBudget?: number;
  budgetTiers?: Record<BudgetTier, number>;
};

const DEFAULT_BUDGET_TIER: BudgetTier = "medium";
const LOCAL_LLAMA_CPP_PROVIDERS: Record<string, true> = {
  "local-llamacpp": true,
  llamacpp: true,
  "llama-mustafar": true,
};

const AGENT_BUDGET_TIER: Record<string, BudgetTier> = {
  planner: "max",
  architect: "max",
  iterative: "max",
  debugger: "high",
  security: "high",
  "algo-solver": "high",
  reviewer: "high",
  auditor: "high",
  general: "medium",
  refactor: "medium",
  "code-gen": "low",
  polyglot: "low",
  search: "none",
  explore: "none",
  library: "none",
  scout: "none",
};

const AGENT_ROLE_PATTERNS: Record<string, readonly string[]> = {
  planner: ["name: planner", "agent: planner"],
  architect: ["name: gemma-architect", "name: architect", "agent: architect"],
  iterative: ["name: iterative-auditor", "agent: iterative-auditor"],
  debugger: ["name: gemma-debugger", "name: debugger", "agent: debugger"],
  security: ["name: security", "agent: security"],
  "algo-solver": ["name: gemma-algo-solver", "name: algo-solver", "agent: algo-solver"],
  reviewer: ["name: gemma-reviewer", "name: reviewer", "agent: reviewer"],
  auditor: ["name: iterative-auditor", "name: auditor", "agent: auditor"],
  general: ["name: gemma-general", "name: general", "agent: general"],
  refactor: ["name: refactor", "agent: refactor"],
  "code-gen": ["name: gemma-code-gen", "name: code-gen", "agent: code-gen"],
  polyglot: ["name: gemma-polyglot", "name: polyglot", "agent: polyglot"],
  search: ["name: search", "agent: search"],
  explore: ["name: explore", "agent: explore"],
  library: ["name: librarian", "name: library", "agent: librarian", "agent: library"],
  scout: ["name: scout", "agent: scout"],
};

const ROLE_GUARDRAILS: Record<string, string> = {
  architect: `ROLE-SPECIFIC GUARDRAIL: architect
- Produce complete contracts: APIs, schemas, state transitions, migration order, failure modes, and verification.
- Do not stop at summaries when implementation details are required.
- Call out compatibility cuts and deleted obsolete paths.
- Format: Problem → Decision → Contract → Migration → Verification → Risks.`,
  planner: `ROLE-SPECIFIC GUARDRAIL: architect
- Produce complete contracts: APIs, schemas, state transitions, migration order, failure modes, and verification.
- Do not stop at summaries when implementation details are required.
- Call out compatibility cuts and deleted obsolete paths.
- Format: Problem → Decision → Contract → Migration → Verification → Risks.`,
  iterative: `ROLE-SPECIFIC GUARDRAIL: iterative-auditor
- Extract requirements and invariants from the PRD/task.
- Check each invariant against code paths, error paths, and tests.
- Separate confirmed bugs from risks.
- Format: Requirement Matrix → Confirmed Findings → Fixes → Verification → Remaining Risks.`,
  auditor: `ROLE-SPECIFIC GUARDRAIL: iterative-auditor
- Extract requirements and invariants from the PRD/task.
- Check each invariant against code paths, error paths, and tests.
- Separate confirmed bugs from risks.
- Format: Requirement Matrix → Confirmed Findings → Fixes → Verification → Remaining Risks.`,
  debugger: `ROLE-SPECIFIC GUARDRAIL: debugger
- List every confirmed bug with file/symbol/location.
- Fix root causes, not symptoms.
- Use diagnostics, references, and focused tests to prove the fix.
- Report exact verification commands and outcomes.`,
  security: `ROLE-SPECIFIC GUARDRAIL: reviewer
- Prioritize correctness, data loss, security, concurrency, lifecycle, and integration bugs.
- Every finding needs file/symbol, impact, and a concrete fix.
- Do not pad with style nits unless they hide a real maintainability risk.`,
  reviewer: `ROLE-SPECIFIC GUARDRAIL: reviewer
- Prioritize correctness, data loss, security, concurrency, lifecycle, and integration bugs.
- Every finding needs file/symbol, impact, and a concrete fix.
- Do not pad with style nits unless they hide a real maintainability risk.`,
  "algo-solver": `ROLE-SPECIFIC GUARDRAIL: algorithm
- State invariants, edge cases, complexity, and proof sketch before final implementation when useful.
- Produce complete runnable code and tests for boundary cases.
- Format: Problem → Invariants → Algorithm → Complexity → Implementation → Tests/verification.`,
  refactor: `ROLE-SPECIFIC GUARDRAIL: refactor
- Preserve behavior unless explicitly asked to change it.
- Migrate every caller and leave no compatibility shims behind.
- Verify behavior with focused tests or typechecks.`,
  "code-gen": `ROLE-SPECIFIC GUARDRAIL: code-generation
- Produce complete runnable code, not snippets or outlines.
- If multiple files are needed, name every file and provide complete content or apply edits directly.
- No placeholders, no TODO implementations, no omitted sections.`,
  polyglot: `ROLE-SPECIFIC GUARDRAIL: polyglot
- Preserve semantics across languages: errors, edge cases, async behavior, resource lifetimes, and types.
- Produce complete files or direct edits, not fragments.
- Include semantic parity notes and verification.`,
  general: `ROLE-SPECIFIC GUARDRAIL: general
- Complete every requested item.
- Output actual deliverables, not descriptions of deliverables.
- No placeholders, omitted sections, or "see above".`,
};

const COMMON_GUARDRAIL = `You are a precise, thorough coding assistant.

OUTPUT DISCIPLINE:
1. When asked to write code, produce COMPLETE, runnable code — not snippets, not placeholders, not "// rest of implementation here".
2. When asked to find bugs, list the bugs AND provide the full fixed code. Do not stop at just the list.
3. When asked to review code, provide findings AND the requested improved version. Not one or the other.
4. When asked for multiple things (languages, problems, sections), complete EACH one fully. Do not skip items.
5. Do NOT use "...", "omitted for brevity", or "as shown above" as substitutes for actual output.
6. If you realize you're about to output the same character or line repeatedly, STOP and produce different content.
7. Do not include internal reasoning, thought blocks, or "Let me think" preambles. Go directly to the output.

PI TOOLING DISCIPLINE:
- Use Pi-specific tools when available for file reads, searches, edits, diagnostics, and shell commands.
- Do not shell out for file search or text lookup when a Pi tool can do it.
- Keep reads targeted after locating relevant files/ranges.

STYLE:
- Follow the exact output format the user requests.
- When no format is specified, use concise markdown with concrete files, symbols, checks, and results.
- Prefer producing the actual content over describing what you would produce.`;

const COMMON_GUARDRAIL_START = "You are a precise, thorough coding assistant.";
const COMMON_GUARDRAIL_END = "- Prefer producing the actual content over describing what you would produce.";

const PROMPT_ONLY_MODEL_CONFIG: ModelConfig = {
  guardrail: COMMON_GUARDRAIL,
};

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gemma-4-12b": {
    temperature: 0.7,
    thinkingMode: "budget",
    defaultThinkingBudget: 0,
    budgetTiers: {
      max: 1024,
      high: 512,
      medium: 256,
      low: 64,
      none: 0,
    },
    guardrail: COMMON_GUARDRAIL,
  },
  "qwen3.6": {
    temperature: 0.6,
    thinkingMode: "chat_template_budget",
    defaultThinkingBudget: 0,
    budgetTiers: {
      max: -1,
      high: 2048,
      medium: 1024,
      low: 512,
      none: 0,
    },
    guardrail: COMMON_GUARDRAIL,
  },
};

function readModelId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const model = "model" in value ? (value as { model: unknown }).model : undefined;
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && "id" in model) {
    const id = (model as { id: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }

  if ("id" in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }

  return undefined;
}

function providerFromModelId(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const separator = modelId.indexOf("/");
  return separator > 0 ? modelId.slice(0, separator).toLowerCase() : undefined;
}

function readProvider(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const provider = "provider" in value ? (value as { provider: unknown }).provider : undefined;
  if (typeof provider === "string") return provider.toLowerCase();

  const model = "model" in value ? (value as { model: unknown }).model : undefined;
  if (model && typeof model === "object" && "provider" in model) {
    const modelProvider = (model as { provider: unknown }).provider;
    if (typeof modelProvider === "string") return modelProvider.toLowerCase();
  }

  return providerFromModelId(readModelId(value));
}

function isLocalLlamaCppRequest(provider: string | undefined, modelId: string | undefined): boolean {
  if (provider) return LOCAL_LLAMA_CPP_PROVIDERS[provider] === true;
  const modelProvider = providerFromModelId(modelId);
  return modelProvider ? LOCAL_LLAMA_CPP_PROVIDERS[modelProvider] === true : false;
}

function readSystemPrompt(value: unknown): string {
  if (!value || typeof value !== "object" || !("systemPrompt" in value)) return "";
  const prompt = (value as { systemPrompt: unknown }).systemPrompt;
  return typeof prompt === "string" ? prompt : "";
}

function readPayload(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || !("payload" in value)) return undefined;
  const payload = (value as { payload: unknown }).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  return payload as Record<string, unknown>;
}


function roleFromPrompt(systemPrompt: string): string | undefined {
  const prompt = systemPrompt.toLowerCase();
  for (const [role, patterns] of Object.entries(AGENT_ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (prompt.includes(pattern)) return role;
    }
  }
  return undefined;
}

function tierFromPrompt(systemPrompt: string): BudgetTier {
  const role = roleFromPrompt(systemPrompt);
  return role ? AGENT_BUDGET_TIER[role] ?? DEFAULT_BUDGET_TIER : DEFAULT_BUDGET_TIER;
}

function buildGuardrail(config: ModelConfig, role: string | undefined): string {
  const roleGuardrail = role ? ROLE_GUARDRAILS[role] : undefined;
  return roleGuardrail ? `${config.guardrail}\n\n${roleGuardrail}` : config.guardrail;
}

function collectStrings(value: unknown, parts: string[], depth: number): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, parts, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, parts, depth + 1);
    }
  }
}

function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectPromptMessageStrings(value: unknown, parts: string[]): void {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (!isMessageRecord(item)) continue;

    const role = item.role;
    if (role !== "system" && role !== "developer") continue;

    collectStrings(item.content, parts, 0);
  }
}

function readPayloadSystemPrompt(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  collectStrings(payload.instructions, parts, 0);
  collectPromptMessageStrings(payload.messages, parts);
  collectPromptMessageStrings(payload.input, parts);
  return parts.join("\n");
}

function hasInjectedGuardrail(prompt: string): boolean {
  return prompt.includes("PI TOOLING DISCIPLINE:");
}

function shouldPrependGuardrail(existing: string): boolean {
  return !hasInjectedGuardrail(existing);
}

function configForModel(modelId: string | undefined): ModelConfig | undefined {
  if (!modelId) return undefined;
  const normalized = modelId.toLowerCase();
  for (const [pattern, config] of Object.entries(MODEL_CONFIGS)) {
    if (normalized.includes(pattern)) return config;
  }
  return undefined;
}

function mergeChatTemplateKwargs(payload: Record<string, unknown>, enableThinking: boolean): void {
  const current = payload.chat_template_kwargs;
  const next: Record<string, unknown> = current && typeof current === "object" && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
  next.enable_thinking = enableThinking;
  payload.chat_template_kwargs = next;
}

function stripLlamaCppOnlyParams(payload: Record<string, unknown>): void {
  delete payload.temperature;
  delete payload.max_tokens;
  delete payload.thinking_budget_tokens;
  delete payload.reasoning_control;
  delete payload.reasoning_format;

  const kwargs = payload.chat_template_kwargs;
  if (!kwargs || typeof kwargs !== "object" || Array.isArray(kwargs)) return;

  const next = { ...(kwargs as Record<string, unknown>) };
  delete next.enable_thinking;
  if (Object.keys(next).length === 0) {
    delete payload.chat_template_kwargs;
  } else {
    payload.chat_template_kwargs = next;
  }
}

function stripInjectedGuardrail(text: string): string {
  if (!text.startsWith(COMMON_GUARDRAIL_START)) return text;

  const commonEnd = text.indexOf(COMMON_GUARDRAIL_END);
  if (commonEnd === -1) return text;

  let rest = text.slice(commonEnd + COMMON_GUARDRAIL_END.length);
  if (rest.startsWith("\n\nROLE-SPECIFIC GUARDRAIL:")) {
    const nextBlock = rest.indexOf("\n\n", 2);
    rest = nextBlock === -1 ? "" : rest.slice(nextBlock);
  }
  if (rest.startsWith("\n\n")) return rest.slice(2);
  return rest;
}

function stripInjectedGuardrails(payload: Record<string, unknown>): void {
  if (typeof payload.instructions === "string") {
    const instructions = stripInjectedGuardrail(payload.instructions);
    if (instructions) {
      payload.instructions = instructions;
    } else {
      delete payload.instructions;
    }
  }

  const messages = payload.messages;
  if (!Array.isArray(messages)) return;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isMessageRecord(message) || typeof message.content !== "string") {
      continue;
    }
    if (message.role !== "system" && message.role !== "developer") {
      continue;
    }
    const content = stripInjectedGuardrail(message.content);
    if (content) {
      message.content = content;
    } else {
      messages.splice(index, 1);
    }
  }
}

function stripLlamaCppInjection(payload: Record<string, unknown>): void {
  stripInjectedGuardrails(payload);
  stripLlamaCppOnlyParams(payload);
}

function prependGuardrailToPayload(payload: Record<string, unknown>, guardrail: string): void {
  const instructions = payload.instructions;
  if (typeof instructions === "string") {
    if (shouldPrependGuardrail(instructions)) {
      payload.instructions = `${guardrail}\n\n${instructions}`;
    }
    return;
  }

  const messages = payload.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!isMessageRecord(message) || message.role !== "system" || typeof message.content !== "string") {
        continue;
      }
      if (shouldPrependGuardrail(message.content)) {
        message.content = `${guardrail}\n\n${message.content}`;
      }
      return;
    }
    messages.unshift({ role: "system", content: guardrail });
  }
}

function removeGeneratedDelegateChains(agentsDir: string): number {
  if (!fs.existsSync(agentsDir)) return 0;

  let removed = 0;
  for (const file of fs.readdirSync(agentsDir)) {
    if (!file.endsWith(".md") || !file.startsWith("delegate.delegate.")) continue;
    fs.rmSync(path.join(agentsDir, file), { force: true });
    removed++;
  }
  return removed;
}

function installPackagedAgents(agentsDir: string): number {
  const packageAgentsDir = path.resolve(__dirname, "..", "agents");
  if (!fs.existsSync(packageAgentsDir)) return 0;
  if (path.resolve(packageAgentsDir) === path.resolve(agentsDir)) return 0;

  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  let installed = 0;
  for (const file of fs.readdirSync(packageAgentsDir)) {
    if (!file.endsWith(".md") || file.startsWith("delegate.")) continue;

    const sourcePath = path.join(packageAgentsDir, file);
    if (!fs.statSync(sourcePath).isFile()) continue;

    const targetPath = path.join(agentsDir, `delegate.${file}`);
    if (fs.existsSync(targetPath)) continue;

    fs.copyFileSync(sourcePath, targetPath);
    installed++;
  }
  return installed;
}

export default function modelGuardrails(pi: ExtensionAPI) {

  let currentModelId: string | undefined;
  let currentRole: string | undefined;
  let currentProvider: string | undefined;
  let currentTier: BudgetTier = DEFAULT_BUDGET_TIER;

  pi.on("model_select", async (event) => {
    currentModelId = readModelId(event)?.toLowerCase();
    currentProvider = readProvider(event);
    currentRole = undefined;
    currentTier = DEFAULT_BUDGET_TIER;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const modelId = readModelId(event)?.toLowerCase() ?? readModelId(ctx.model)?.toLowerCase() ?? currentModelId;
    const provider = readProvider(event) ?? readProvider(ctx.model) ?? currentProvider;
    if (!isLocalLlamaCppRequest(provider, modelId)) return;

    const systemPrompt = readSystemPrompt(event);
    if (hasInjectedGuardrail(systemPrompt)) return;

    currentProvider = provider ?? providerFromModelId(modelId) ?? currentProvider;
    if (modelId) currentModelId = modelId;
    currentTier = tierFromPrompt(systemPrompt);
    currentRole = roleFromPrompt(systemPrompt);
  });

  pi.on("before_provider_request", (event, ctx) => {
    const payload = readPayload(event);
    if (!payload) return;

    const eventProvider = readProvider(event) ?? readProvider(ctx.model);
    const payloadModelId = readModelId(payload)?.toLowerCase();
    const ctxModelId = readModelId(ctx.model)?.toLowerCase();
    const modelId = ctxModelId ?? payloadModelId;

    if (!isLocalLlamaCppRequest(eventProvider, modelId)) {
      stripLlamaCppInjection(payload);
      currentProvider = eventProvider;
      currentModelId = modelId;
      currentRole = undefined;
      currentTier = DEFAULT_BUDGET_TIER;
      return payload;
    }

    const llamaModelId = ctxModelId ?? payloadModelId ?? currentModelId;
    const config = configForModel(llamaModelId) ?? PROMPT_ONLY_MODEL_CONFIG;

    currentProvider = eventProvider ?? providerFromModelId(llamaModelId) ?? currentProvider;
    if (llamaModelId) currentModelId = llamaModelId;

    const payloadPrompt = readPayloadSystemPrompt(payload);
    if (payloadPrompt && !hasInjectedGuardrail(payloadPrompt)) {
      currentTier = tierFromPrompt(payloadPrompt);
      currentRole = roleFromPrompt(payloadPrompt);
    }

    prependGuardrailToPayload(payload, buildGuardrail(config, currentRole));

    if (typeof config.temperature === "number") {
      payload.temperature = config.temperature;
    }

    if (typeof config.maxTokens === "number") {
      payload.max_tokens = config.maxTokens;
    }

    if (config.budgetTiers && typeof config.defaultThinkingBudget === "number") {
      const budget = config.budgetTiers[currentTier] ?? config.defaultThinkingBudget;
      payload.thinking_budget_tokens = budget;
      payload.reasoning_control = true;

      if (config.thinkingMode === "chat_template_budget") {
        payload.reasoning_format = "deepseek";
        mergeChatTemplateKwargs(payload, budget !== 0);
      }
    }

    return payload;
  });

  pi.on("session_start", async (event) => {
    if (event.reason !== "startup" && event.reason !== "reload") return;

    const agentsDir = path.join(process.env.HOME || "/tmp", ".pi", "agent", "agents");
    const removed = removeGeneratedDelegateChains(agentsDir);
    const installed = installPackagedAgents(agentsDir);

    if (removed > 0) {
      pi.log?.(`model-guardrails: removed ${removed} generated duplicate agent config(s)`);
    }
    if (installed > 0) {
      pi.log?.(`model-guardrails: installed ${installed} agent config(s)`);
    }
  });
}
