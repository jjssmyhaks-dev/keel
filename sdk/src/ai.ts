import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import type { Keel } from "./index";
import { buildAgentToolSpecs, invokeAgentTool } from "./agent-tools";

export interface KeelAiToolsOptions {
  keel: Keel;
  /** The agent whose grants define the tool list. */
  agentId: string;
  /** Only expose actions for one connector, e.g. slack. */
  connector?: string;
}

/**
 * Vercel AI SDK tools backed by Keel. Each tool is one action the agent is
 * granted; execution goes through the proxy, so approvals and audit apply.
 *
 * ```ts
 * import { keelAiTools } from "@keel/sdk/ai";
 * import { generateText } from "ai";
 *
 * const tools = await keelAiTools({ keel, agentId: "agt_atlas" });
 * const result = await generateText({ model, tools, prompt });
 * ```
 */
export async function keelAiTools(options: KeelAiToolsOptions): Promise<ToolSet> {
  const specs = await buildAgentToolSpecs(options.keel, options.agentId, { connector: options.connector });
  const tools: ToolSet = {};

  for (const spec of specs) {
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.inputSchema as JSONSchema7),
      execute: async (input) =>
        invokeAgentTool(options.keel, spec, options.agentId, input as Record<string, unknown>),
    });
  }

  return tools;
}
