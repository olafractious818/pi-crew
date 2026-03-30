import { Type } from "@sinclair/typebox";
import {
	renderCrewCall,
	renderCrewResult,
	toolError,
	toolSuccess,
	truncatePreview,
} from "../ui-helpers.js";
import type { CrewToolDeps } from "./shared.js";

export function registerCrewRespondTool({ pi, crewManager }: CrewToolDeps): void {
	pi.registerTool({
		name: "crew_respond",
		label: "Respond to Crew",
		description:
			"Send a follow-up message to an interactive subagent that is waiting for a response. Use crew_list to see waiting subagents.",
		parameters: Type.Object({
			subagent_id: Type.String({
				description:
					"ID of the waiting subagent (from crew_list or crew_spawn result)",
			}),
			message: Type.String({ description: "Message to send to the subagent" }),
		}),
		promptSnippet:
			"Send a follow-up message to a waiting interactive subagent.",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const callerSessionId = ctx.sessionManager.getSessionId();
			const { error } = crewManager.respond(
				params.subagent_id,
				params.message,
				pi,
				callerSessionId,
			);
			if (error) return toolError(error);

			return toolSuccess(
				`Message sent to subagent ${params.subagent_id}. Response will be delivered as a steering message.`,
				{ id: params.subagent_id },
			);
		},

		renderCall(args, theme, _context) {
			const preview = args.message ? truncatePreview(args.message, 60) : "...";
			return renderCrewCall(
				theme,
				"crew_respond",
				args.subagent_id || "...",
				preview,
			);
		},

		renderResult(result, _options, theme, _context) {
			return renderCrewResult(result, theme);
		},
	});
}
