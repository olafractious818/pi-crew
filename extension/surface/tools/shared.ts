import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { AgentDiscoveryWarning } from "../../agents.js";
import type { CrewManager } from "../../runner.js";

export interface CrewToolDeps {
	pi: ExtensionAPI;
	crewManager: CrewManager;
	notifyDiscoveryWarnings: (
		ctx: ExtensionContext,
		warnings: AgentDiscoveryWarning[],
	) => void;
}
