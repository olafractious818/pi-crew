import {
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Box, Markdown, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type AgentDiscoveryWarning, discoverAgents } from "./agents.js";
import type { CrewManager } from "./runner.js";
import { STATUS_ICON, type SubagentStatus } from "./steering.js";

function renderCrewCall(
	theme: Parameters<Exclude<Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"], undefined>>[1],
	name: string,
	id: string,
	preview?: string,
): Text {
	let text = theme.fg("toolTitle", theme.bold(`${name} `)) + theme.fg("accent", id);
	if (preview) text += theme.fg("dim", ` "${preview}"`);
	return new Text(text, 0, 0);
}

function renderCrewResult(
	result: { content: { type: string; text?: string }[]; details: unknown },
	theme: Parameters<Exclude<Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"], undefined>>[2],
): Text {
	const text = result.content[0];
	const details = result.details as { error?: boolean } | undefined;
	const content = text?.type === "text" && text.text ? text.text : "(no output)";
	return new Text(details?.error ? theme.fg("error", content) : theme.fg("success", content), 0, 0);
}

export function registerCrewSurface(pi: ExtensionAPI, crewManager: CrewManager): void {
	const shownDiscoveryWarnings = new Set<string>();

	const notifyDiscoveryWarnings = (
		ctx: ExtensionContext,
		warnings: AgentDiscoveryWarning[],
	) => {
		if (!ctx.hasUI) return;
		for (const warning of warnings) {
			const key = `${warning.filePath}:${warning.message}`;
			if (shownDiscoveryWarnings.has(key)) continue;
			shownDiscoveryWarnings.add(key);
			ctx.ui.notify(`${warning.message} (${warning.filePath})`, "error");
		}
	};

	// =========================================================================
	// Tool: crew_list
	// =========================================================================

	pi.registerTool({
		name: "crew_list",
		label: "List Crew",
		description:
			"List available agent definitions (from ~/.pi/agent/agents/*.md) and currently running agents with their status.",
		parameters: Type.Object({}),
		promptSnippet: "List agent definitions and active agents",

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const { agents, warnings } = discoverAgents();
			notifyDiscoveryWarnings(ctx, warnings);
			const callerSessionFile = ctx.sessionManager.getSessionFile();
			const running = crewManager.getActiveForOwner(callerSessionFile);

			const lines: string[] = [];

			lines.push("## Available agents");
			if (agents.length === 0) {
				lines.push(
					"No valid agent definitions found. Add `.md` files to `~/.pi/agent/agents/`.",
				);
			} else {
				for (const a of agents) {
					lines.push("");
					lines.push(`**${a.name}**`);
					if (a.description) lines.push(`  ${a.description}`);
					if (a.model) lines.push(`  model: ${a.model}`);
					if (a.interactive) lines.push(`  interactive: true`);
					if (a.tools) lines.push(`  tools: ${a.tools.join(", ")}`);
					if (a.skills) lines.push(`  skills: ${a.skills.join(", ")}`);
				}
			}

			if (warnings.length > 0) {
				lines.push("");
				lines.push("## Ignored agent definitions");
				for (const warning of warnings) {
					lines.push(`- ${warning.message} (${warning.filePath})`);
				}
			}

			lines.push("");
			lines.push("## Active agents");
			if (running.length === 0) {
				lines.push("No agents currently active.");
			} else {
				for (const s of running) {
					const icon = STATUS_ICON[s.status as SubagentStatus] ?? "❓";
					const taskPreview = s.task.length > 80 ? `${s.task.slice(0, 80)}...` : s.task;
					lines.push("");
					lines.push(`**${s.id}** (${s.agentConfig.name}) — ${icon} ${s.status}`);
					lines.push(`  task: ${taskPreview}`);
					lines.push(`  turns: ${s.turns}`);
				}
			}

			const text = lines.join("\n");
			return { content: [{ type: "text", text }], details: {} };
		},

		renderCall(_args, theme, _context) {
			return new Text(theme.fg("toolTitle", theme.bold("crew_list")), 0, 0);
		},

		renderResult(result, _options, _theme, _context) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

	// =========================================================================
	// Tool: crew_spawn
	// =========================================================================

	pi.registerTool({
		name: "crew_spawn",
		label: "Spawn Crew",
		description:
			"Spawn a non-blocking agent that runs in an isolated session. The agent works independently while the main session stays interactive. Results are delivered as steering messages when done. Use crew_list first to see available agents.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name from crew_list" }),
			task: Type.String({ description: "Task to delegate to the agent" }),
		}),
		promptSnippet:
			"Spawn a non-blocking agent. Use crew_list first to see available agents.",
		promptGuidelines: [
			"crew_spawn: Always call crew_list first to see which agents are available before spawning.",
			"crew_spawn: The spawned agent runs in a separate context window with no access to the current conversation. Include all relevant context (file paths, requirements, prior findings) directly in the task parameter.",
			"crew_spawn: Results are delivered asynchronously as steering messages. Do not block or poll for completion; continue working on other tasks.",
			"crew_spawn: Interactive agents (marked with 'interactive' in crew_list) stay alive after responding. Use crew_respond to continue the conversation and crew_done to close when finished.",
		],

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { agents, warnings } = discoverAgents();
			notifyDiscoveryWarnings(ctx, warnings);
			const agent = agents.find((a) => a.name === params.agent);

			if (!agent) {
				const available = agents.map((a) => a.name).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Unknown agent: "${params.agent}". Available: ${available}`,
						},
					],
					isError: true,
					details: {},
				};
			}

			const parentSessionFile = ctx.sessionManager.getSessionFile();
			const id = crewManager.spawn(
				agent,
				params.task,
				ctx.cwd,
				parentSessionFile,
				ctx,
				pi,
			);

			return {
				content: [
					{
						type: "text",
						text: `Agent '${agent.name}' spawned as ${id}. Result will be delivered as a steering message when done.`,
					},
				],
				details: { id },
			};
		},

		renderCall(args, theme, _context) {
			const preview = args.task
				? args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task
				: "...";
			return renderCrewCall(theme, "crew_spawn", args.agent || "...", preview);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});

	// =========================================================================
	// Tool: crew_respond
	// =========================================================================

	pi.registerTool({
		name: "crew_respond",
		label: "Respond to Crew",
		description:
			"Send a follow-up message to an interactive agent that is waiting for a response. Use crew_list to see waiting agents.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "ID of the waiting agent (from crew_list or crew_spawn result)" }),
			message: Type.String({ description: "Message to send to the agent" }),
		}),
		promptSnippet: "Send a follow-up message to a waiting interactive agent.",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const callerSessionFile = ctx.sessionManager.getSessionFile();
			const { error } = crewManager.respond(params.agent_id, params.message, pi, callerSessionFile);

			if (error) {
				return {
					content: [{ type: "text", text: error }],
					isError: true,
					details: { error: true },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Message sent to agent ${params.agent_id}. Response will be delivered as a steering message.`,
					},
				],
				details: { id: params.agent_id },
			};
		},

		renderCall(args, theme, _context) {
			const preview = args.message
				? args.message.length > 60 ? `${args.message.slice(0, 60)}...` : args.message
				: "...";
			return renderCrewCall(theme, "crew_respond", args.agent_id || "...", preview);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});

	// =========================================================================
	// Tool: crew_done
	// =========================================================================

	pi.registerTool({
		name: "crew_done",
		label: "Done with Crew",
		description:
			"Close an interactive agent session. Use when you no longer need to interact with the agent.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "ID of the agent to close" }),
		}),
		promptSnippet: "Close an interactive agent session when done.",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const callerSessionFile = ctx.sessionManager.getSessionFile();
			const { error } = crewManager.done(params.agent_id, callerSessionFile);

			if (error) {
				return {
					content: [{ type: "text", text: error }],
					isError: true,
					details: { error: true },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Agent ${params.agent_id} closed.`,
					},
				],
				details: { id: params.agent_id },
			};
		},

		renderCall(args, theme, _context) {
			return renderCrewCall(theme, "crew_done", args.agent_id || "...");
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});

	// =========================================================================
	// Command: /crew-abort
	// =========================================================================

	pi.registerCommand("crew-abort", {
		description: "Abort an active agent",

		getArgumentCompletions(argumentPrefix) {
			const active = crewManager.getActive();
			if (active.length === 0) return null;
			return active
				.filter((s) => s.id.startsWith(argumentPrefix))
				.map((s) => ({
					value: s.id,
					label: `${s.id} (${s.agentConfig.name})`,
				}));
		},

		async handler(args, ctx) {
			const trimmed = args.trim();

			if (trimmed) {
				const success = crewManager.abort(trimmed, pi);
				if (!success) {
					ctx.ui.notify(`No active agent with id "${trimmed}"`, "error");
				} else {
					ctx.ui.notify(`Agent ${trimmed} aborted`, "info");
				}
				return;
			}

			const active = crewManager.getActive();
			if (active.length === 0) {
				ctx.ui.notify("No active agents", "info");
				return;
			}

			const options = active.map((s) => ({
				id: s.id,
				label: `${s.id} (${s.agentConfig.name})`,
			}));
			const selected = await ctx.ui.select(
				"Select agent to abort",
				options.map((option) => option.label),
			);

			if (!selected) return;

			const selectedOption = options.find((option) => option.label === selected);
			if (!selectedOption) return;

			const success = crewManager.abort(selectedOption.id, pi);
			if (success) {
				ctx.ui.notify(`Agent ${selectedOption.id} aborted`, "info");
			} else {
				ctx.ui.notify(`Agent ${selectedOption.id} already finished`, "error");
			}
		},
	});

	// =========================================================================
	// Message Renderer: crew-result
	// =========================================================================

	pi.registerMessageRenderer("crew-result", (message, { expanded }, theme) => {
		const details = message.details as
			| { agentId: string; agentName: string; error?: boolean }
			| undefined;

		const isError = details?.error ?? false;
		const agentLabel = details
			? `${details.agentName} (${details.agentId})`
			: "agent";

		const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
		const header = `${icon} ${theme.fg("toolTitle", theme.bold(agentLabel))}`;

		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(header, 0, 0));

		if (message.content) {
			const content = String(message.content);
			if (expanded) {
				box.addChild(new Text("", 0, 0));
				box.addChild(new Markdown(content, 0, 0, getMarkdownTheme()));
			} else {
				const preview = content.split("\n").slice(0, 5).join("\n");
				box.addChild(new Text(theme.fg("dim", preview), 0, 0));
				if (content.split("\n").length > 5) {
					box.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), 0, 0));
				}
			}
		}

		return box;
	});
}
