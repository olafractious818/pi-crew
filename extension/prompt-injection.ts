import type { AgentConfig } from "./agent-discovery.js";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format discovered agent definitions for inclusion in the system prompt.
 * Uses XML format consistent with pi's skill injection.
 *
 * Returns an empty string when no agents are available.
 */
export function formatAgentsForPrompt(agents: AgentConfig[]): string {
  if (agents.length === 0) return "";

  const lines: string[] = [
    "",
    "",
    "---",
    "The following subagents can be spawned via crew_spawn to handle tasks in parallel.",
    "Use crew_list to see their current status. Interactive subagents stay alive after responding;",
    "use crew_respond to continue and crew_done to close them.",
    "",
    "<available_subagents>",
  ];

  for (const agent of agents) {
    lines.push("  <subagent>");
    lines.push(`    <name>${escapeXml(agent.name)}</name>`);
    lines.push(
      `    <description>${escapeXml(agent.description)}</description>`,
    );
    lines.push(
      `    <interactive>${agent.interactive ? "true" : "false"}</interactive>`,
    );
    lines.push("  </subagent>");
  }

  lines.push("</available_subagents>");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}
