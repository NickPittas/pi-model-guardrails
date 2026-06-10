import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

export default function (pi: ExtensionAPI) {
  // ── Configuration ──

  interface ModelConfig {
    guardrail?: string;
    temperature?: number;
    maxTokens?: number;
  }

  // Per-agent reasoning effort overrides.
  // Detected by searching the agent's system prompt for these substrings.
  // Keys are lowercase substrings to match in the system prompt.
  const AGENT_REASONING: Record<string, string> = {
    // High reasoning: tasks that need deep analysis
    "debugger": "high",
    "security": "high",
    "algo-solver": "high",

    // Medium reasoning: tasks that need understanding but output is priority
    "reviewer": "medium",
    "refactor": "medium",

    // Low reasoning: volume tasks where tokens should go to content
    "polyglot": "low",
    "architect": "low",
    "code-gen": "low",
  };

  const DEFAULT_REASONING = "none";

  const MODEL_CONFIGS: Record<string, ModelConfig> = {
    "gemma-4-12b": {
      temperature: 0.7,

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
  };

  // ── State ──
  let currentModelId: string | undefined;
  let currentReasoningEffort: string = DEFAULT_REASONING;

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

  // ── Detect agent type from system prompt and set reasoning level ──
  pi.on("before_agent_start", async (event, _ctx) => {
    const config = getModelConfig();
    if (!config) return;

    // Detect which agent is running by checking the system prompt
    const prompt = (event.systemPrompt || "").toLowerCase();
    let detectedReasoning = DEFAULT_REASONING;
    for (const [substring, reasoning] of Object.entries(AGENT_REASONING)) {
      if (prompt.includes(substring.toLowerCase())) {
        detectedReasoning = reasoning;
        break;
      }
    }
    currentReasoningEffort = detectedReasoning;

    return {
      systemPrompt: config.guardrail + "\n\n" + event.systemPrompt,
    };
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

    // Use the reasoning effort detected from the agent type
    payload.reasoning_effort = currentReasoningEffort;
    modified = true;

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
