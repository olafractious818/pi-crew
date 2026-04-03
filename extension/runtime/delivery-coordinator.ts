import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	type SteeringPayload,
	sendRemainingNote,
	sendSteeringMessage,
} from "../subagent-messages.js";

interface PendingMessage {
	ownerSessionId: string;
	payload: SteeringPayload;
}

export class DeliveryCoordinator {
	private currentSessionId: string | undefined;
	private currentIsIdle: () => boolean = () => true;
	private pendingMessages: PendingMessage[] = [];

	activateSession(
		sessionId: string,
		isIdle: () => boolean,
		pi: ExtensionAPI,
		countRunningForOwner: (ownerSessionId: string, excludeId: string) => number,
	): void {
		this.currentSessionId = sessionId;
		this.currentIsIdle = isIdle;
		// Delay flush to next macrotask. session_start fires before pi-core
		// calls _reconnectToAgent(), so synchronous delivery would emit agent
		// events while the session listener is disconnected, losing JSONL persistence.
		if (this.pendingMessages.some((entry) => entry.ownerSessionId === sessionId)) {
			setTimeout(() => this.flushPending(pi, countRunningForOwner), 0);
		}
	}

	deliver(
		ownerSessionId: string,
		payload: SteeringPayload,
		pi: ExtensionAPI,
		countRunningForOwner: (ownerSessionId: string, excludeId: string) => number,
	): void {
		if (ownerSessionId !== this.currentSessionId) {
			this.pendingMessages.push({ ownerSessionId, payload });
			return;
		}

		this.send(ownerSessionId, payload, pi, countRunningForOwner);
	}

	clearPendingForOwner(ownerSessionId: string): void {
		this.pendingMessages = this.pendingMessages.filter(
			(entry) => entry.ownerSessionId !== ownerSessionId,
		);
	}

	private flushPending(
		pi: ExtensionAPI,
		countRunningForOwner: (ownerSessionId: string, excludeId: string) => number,
	): void {
		const toDeliver: PendingMessage[] = [];
		const remaining: PendingMessage[] = [];

		for (const entry of this.pendingMessages) {
			if (entry.ownerSessionId === this.currentSessionId) {
				toDeliver.push(entry);
			} else {
				remaining.push(entry);
			}
		}

		this.pendingMessages = remaining;
		for (const entry of toDeliver) {
			this.send(entry.ownerSessionId, entry.payload, pi, countRunningForOwner);
		}
	}

	/**
	 * Result messages always go first. If more subagents are still running and the
	 * owner is idle, queue the result without triggering, then queue the separate
	 * remaining note with triggerTurn so the next turn sees both in order.
	 */
	private send(
		ownerSessionId: string,
		payload: SteeringPayload,
		pi: ExtensionAPI,
		countRunningForOwner: (ownerSessionId: string, excludeId: string) => number,
	): void {
		const remaining = countRunningForOwner(ownerSessionId, payload.id);
		const isIdle = this.currentIsIdle();
		const triggerResultTurn = !(isIdle && remaining > 0);

		sendSteeringMessage(payload, pi, {
			isIdle,
			triggerTurn: triggerResultTurn,
		});
		sendRemainingNote(remaining, pi, {
			isIdle,
			triggerTurn: isIdle && remaining > 0,
		});
	}
}
