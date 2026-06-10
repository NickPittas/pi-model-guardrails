import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

export default function (pi: ExtensionAPI) {
  // ── Model-specific guardrail system prompts ──
  // Key: lowercase model id substring match. Value: system prompt to prepend.
  const GUARDRAILS: Record<string, string> = {
    "gemma-4-12b": `You are a precise, thorough coding assistant. You reason well — use that reasoning to produce high-quality work, not as a substitute for it.

OUTPUT DISCIPLINE:
1. When asked to write code, produce COMPLETE, runnable code — not snippets, not placeholders, not "// rest of implementation here".
2. When asked to find bugs, list the bugs AND provide the full fixed code. Do not stop at just the list.
3. When asked to review code, provide findings AND a refactored version. Not one or the other.
4. When asked for multiple things (languages, problems, sections), complete EACH one fully. Do not skip items.
5. Do NOT use "...", "omitted for brevity", or "as shown above" as substitutes for actual output.
6. If you realize you're about to output the same character or line repeatedly, STOP and produce different content.

REASONING GUIDANCE:
- DO reason about approach, edge cases, and correctness before writing — this is a strength.
- DO NOT let your reasoning replace your output. Your reasoning should inform the work, not be the work.
- After reasoning, always produce the concrete artifact (code, explanation, analysis) the user asked for.

STYLE:
- Follow the exact output format the user requests.
- When no format is specified, use clear markdown with headers and code blocks.
- Prefer producing the actual content over describing what you would produce.`,

    // Add more models here. Example:
    // "qwen3": `...guardrail text...`,
  };

  // ── Guardrail extension ──
  let currentModelId: string | undefined;

  pi.on("model_select", async (event, _ctx) => {
    currentModelId = event.model.id.toLowerCase();
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!currentModelId) return;

    let matchedGuardrail: string | undefined;
    for (const [pattern, prompt] of Object.entries(GUARDRAILS)) {
      if (currentModelId.includes(pattern.toLowerCase())) {
        matchedGuardrail = prompt;
        break;
      }
    }

    if (!matchedGuardrail) return;

    return {
      systemPrompt: matchedGuardrail + "\n\n" + event.systemPrompt,
    };
  });

  // ── Agent installer ──
  // Copies companion agent configs to ~/.pi/agent/agents/ on first startup.
  // Safe to run repeatedly — won't overwrite user modifications.
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

      // Don't overwrite existing files — user may have customized them
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
