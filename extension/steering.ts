import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type SubagentStatus = "running" | "waiting" | "done" | "error" | "aborted";

export const STATUS_ICON: Record<SubagentStatus, string> = {
	running: "⏳",
	waiting: "⏳",
	done: "✅",
	error: "❌",
	aborted: "⏹️",
};

export const STATUS_LABEL: Record<SubagentStatus, string> = {
	running: "running",
	waiting: "waiting for response",
	done: "done",
	error: "failed",
	aborted: "aborted",
};

export interface SteeringPayload {
	id: string;
	agentName: string;
	status: SubagentStatus;
	result?: string;
	error?: string;
}

export function sendSteeringMessage(
	payload: SteeringPayload,
	pi: ExtensionAPI,
	isIdle: boolean,
): void {
	const icon = STATUS_ICON[payload.status];
	const label = STATUS_LABEL[payload.status];
	const header = `**${icon} Agent '${payload.agentName}' (${payload.id}) ${label}**`;
	const body = payload.result ?? payload.error;
	const content = body ? `${header}\n\n${body}` : header;

	const message = {
		customType: "crew-result",
		content,
		display: true,
		details: {
			agentId: payload.id,
			agentName: payload.agentName,
			error: payload.status === "error" || payload.status === "aborted",
		},
	};

	pi.sendMessage(
		message,
		isIdle
			? { triggerTurn: true }
			: { deliverAs: "steer", triggerTurn: true },
	);
}
