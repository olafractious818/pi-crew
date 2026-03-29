import { randomBytes } from "node:crypto";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import { bootstrapSession } from "./session-factory.js";
import { type SubagentStatus, sendSteeringMessage } from "./steering.js";

export interface SubagentState {
	id: string;
	agentConfig: AgentConfig;
	task: string;
	status: SubagentStatus;
	ownerSessionFile: string | undefined;
	session: AgentSession | null;
	turns: number;
	contextTokens: number;
	model: string | undefined;
	error?: string;
	result?: string;
}

function generateId(name: string, existingIds: Set<string>): string {
	for (let i = 0; i < 10; i++) {
		const id = `${name}-${randomBytes(4).toString("hex")}`;
		if (!existingIds.has(id)) return id;
	}
	return `${name}-${randomBytes(8).toString("hex")}`;
}

// Status may change externally via abort(). Standalone function avoids TS narrowing.
function isAborted(state: SubagentState): boolean {
	return state.status === "aborted";
}

function extractLastAssistantText(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			const texts: string[] = [];
			for (const part of assistantMsg.content) {
				if (part.type === "text") {
					texts.push(part.text);
				}
			}
			if (texts.length > 0) return texts.join("\n");
		}
	}
	return undefined;
}

export class CrewManager {
	private activeAgents = new Map<string, SubagentState>();
	private extensionResolvedPath: string;

	onWidgetUpdate: (() => void) | undefined;
	isIdle: (() => boolean) | undefined;

	constructor(extensionResolvedPath: string) {
		this.extensionResolvedPath = extensionResolvedPath;
	}

	spawn(
		agentConfig: AgentConfig,
		task: string,
		cwd: string,
		parentSessionFile: string | undefined,
		ctx: ExtensionContext,
		pi: ExtensionAPI,
	): string {
		const existingIds = new Set(this.activeAgents.keys());
		const id = generateId(agentConfig.name, existingIds);
		const state: SubagentState = {
			id,
			agentConfig,
			task,
			status: "running",
			ownerSessionFile: parentSessionFile,
			session: null,
			turns: 0,
			contextTokens: 0,
			model: undefined,
		};

		this.activeAgents.set(id, state);
		this.onWidgetUpdate?.();
		void this.spawnSession(state, cwd, parentSessionFile, ctx, pi);

		return id;
	}

	private attachSessionListeners(state: SubagentState, session: AgentSession): void {
		session.subscribe((event) => {
			if (event.type !== "turn_end") return;

			state.turns++;
			const msg = event.message;
			if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				state.contextTokens = assistantMsg.usage.totalTokens;
				state.model = assistantMsg.model;
			}
			this.onWidgetUpdate?.();
		});
	}

	private finalizeAgent(state: SubagentState, pi: ExtensionAPI): void {
		sendSteeringMessage(
			{
				id: state.id,
				agentName: state.agentConfig.name,
				status: state.status,
				result: state.result,
				error: state.error,
			},
			pi,
			this.isIdle?.() ?? true,
		);

		if (state.status !== "waiting") {
			this.disposeAgent(state);
		} else {
			this.onWidgetUpdate?.();
		}
	}

	private disposeAgent(state: SubagentState): void {
		state.session?.dispose();
		this.activeAgents.delete(state.id);
		this.onWidgetUpdate?.();
	}

	private async spawnSession(
		state: SubagentState,
		cwd: string,
		parentSessionFile: string | undefined,
		ctx: ExtensionContext,
		pi: ExtensionAPI,
	): Promise<void> {
		try {
			if (isAborted(state)) return;

			const sessionResult = await bootstrapSession({
				agentConfig: state.agentConfig,
				cwd,
				ctx,
				extensionResolvedPath: this.extensionResolvedPath,
				parentSessionFile,
			});

			const { session } = sessionResult;
			state.session = session;
			if (isAborted(state)) return;

			this.attachSessionListeners(state, session);
			await session.prompt(state.task);
			if (isAborted(state)) return;

			state.result = extractLastAssistantText(session.messages) ?? "(no output)";
			state.status = state.agentConfig.interactive ? "waiting" : "done";
			this.finalizeAgent(state, pi);
		} catch (err) {
			if (isAborted(state)) return;

			state.status = "error";
			state.error = err instanceof Error ? err.message : String(err);
			this.finalizeAgent(state, pi);
		} finally {
			if (!this.activeAgents.has(state.id)) {
				// Agent removed (by abort or finalize) but session may have been
				// created after removal. Dispose to prevent leak.
				state.session?.dispose();
			} else if (state.status !== "waiting") {
				this.disposeAgent(state);
			}
		}
	}

	respond(
		id: string,
		message: string,
		pi: ExtensionAPI,
		callerSessionFile: string | undefined,
	): { error?: string } {
		const state = this.activeAgents.get(id);
		if (!state) return { error: `No agent with id "${id}"` };
		if (state.ownerSessionFile !== callerSessionFile) {
			return { error: `Agent "${id}" belongs to a different session` };
		}
		if (state.status !== "waiting") {
			return { error: `Agent "${id}" is not waiting for a response (status: ${state.status})` };
		}
		if (!state.session) return { error: `Agent "${id}" has no active session` };

		state.status = "running";
		this.onWidgetUpdate?.();
		void this.runFollowUp(state, message, pi);
		return {};
	}

	private async runFollowUp(state: SubagentState, message: string, pi: ExtensionAPI): Promise<void> {
		try {
			await state.session!.prompt(message);
			if (isAborted(state)) return;

			state.result = extractLastAssistantText(state.session!.messages) ?? "(no output)";
			state.status = state.agentConfig.interactive ? "waiting" : "done";
			this.finalizeAgent(state, pi);
		} catch (err) {
			if (isAborted(state)) return;

			state.status = "error";
			state.error = err instanceof Error ? err.message : String(err);
			this.finalizeAgent(state, pi);
		}
	}

	done(id: string, callerSessionFile: string | undefined): { error?: string } {
		const state = this.activeAgents.get(id);
		if (!state) return { error: `No active agent with id "${id}"` };
		if (state.ownerSessionFile !== callerSessionFile) {
			return { error: `Agent "${id}" belongs to a different session` };
		}
		if (state.status !== "waiting") {
			return { error: `Agent "${id}" is not in waiting state` };
		}

		this.disposeAgent(state);
		return {};
	}

	abort(id: string, pi: ExtensionAPI): boolean {
		const state = this.activeAgents.get(id);
		if (!state) return false;

		state.status = "aborted";
		state.error = "Aborted by user";
		state.session?.abort().catch(() => {});
		this.finalizeAgent(state, pi);
		return true;
	}

	abortAll(pi: ExtensionAPI): void {
		for (const [id] of this.activeAgents) {
			this.abort(id, pi);
		}
	}

	getActive(): SubagentState[] {
		return Array.from(this.activeAgents.values()).filter(
			(s) => s.status === "running" || s.status === "waiting",
		);
	}

	getActiveForOwner(ownerSessionFile: string | undefined): SubagentState[] {
		return Array.from(this.activeAgents.values()).filter(
			(s) =>
				(s.status === "running" || s.status === "waiting") &&
				s.ownerSessionFile === ownerSessionFile,
		);
	}
}
