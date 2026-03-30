import { Type } from "@sinclair/typebox";
import { discoverAgents } from "../../agents.js";
import {
	renderCrewCall,
	renderCrewResult,
	toolError,
	toolSuccess,
	truncatePreview,
} from "../ui-helpers.js";
import type { CrewToolDeps } from "./shared.js";

export function registerCrewSpawnTool({
	pi,
	crewManager,
	notifyDiscoveryWarnings,
}: CrewToolDeps): void {
	pi.registerTool({
		name: "crew_spawn",
		label: "Spawn Crew",
		description:
			"Spawn a non-blocking subagent that runs in an isolated session. The subagent works independently while the current session stays interactive. Results are delivered back to the spawning session as steering messages when done. Use crew_list first to see available subagents.",
		parameters: Type.Object({
			subagent: Type.String({ description: "Subagent name from crew_list" }),
			task: Type.String({ description: "Task to delegate to the subagent" }),
		}),
		promptSnippet:
			"Spawn a non-blocking subagent. Use crew_list first to see available subagents.",
		promptGuidelines: [
			"Use crew_* tools to delegate parallelizable, independent tasks to specialized subagents. For interactive multi-turn workflows, use crew_respond/crew_done. Avoid spawning for trivial, single-turn tasks.",
			"crew_spawn: Always call crew_list first to see which subagents are available before spawning.",
			"crew_spawn: The spawned subagent runs in a separate context window with no access to the current conversation. Include all relevant context (file paths, requirements, prior findings) directly in the task parameter.",
			"crew_spawn: Results are delivered asynchronously as steering messages. Do not block or poll for completion; continue working on other tasks.",
			"crew_spawn: Interactive subagents (marked with 'interactive' in crew_list) stay alive after responding. Use crew_respond to continue the conversation and crew_done to close when finished.",
			"crew_spawn: When multiple subagents are spawned, each result arrives as a separate steering message. NEVER predict or fabricate results for subagents that have not yet reported back. Wait for ALL crew-result messages.",
		],

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { agents, warnings } = discoverAgents();
			notifyDiscoveryWarnings(ctx, warnings);
			const subagent = agents.find(
				(candidate) => candidate.name === params.subagent,
			);

			if (!subagent) {
				const available =
					agents.map((candidate) => candidate.name).join(", ") || "none";
				return toolError(
					`Unknown subagent: "${params.subagent}". Available: ${available}`,
				);
			}

			const ownerSessionId = ctx.sessionManager.getSessionId();
			const id = crewManager.spawn(
				subagent,
				params.task,
				ctx.cwd,
				ownerSessionId,
				ctx,
				pi,
			);

			return toolSuccess(
				`Subagent '${subagent.name}' spawned as ${id}. Result will be delivered as a steering message when done.`,
				{ id },
			);
		},

		renderCall(args, theme, _context) {
			const preview = args.task ? truncatePreview(args.task, 60) : "...";
			return renderCrewCall(
				theme,
				"crew_spawn",
				args.subagent || "...",
				preview,
			);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}
