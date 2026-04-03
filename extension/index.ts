import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "./agent-discovery.js";
import { CrewManager } from "./crew-manager.js";
import { registerCrewIntegration } from "./integration.js";
import { formatAgentsForPrompt } from "./prompt-injection.js";
import { updateWidget } from "./status-widget.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
	const crewManager = new CrewManager(extensionDir);
	let currentCtx: ExtensionContext | undefined;
	let cachedPromptSuffix = "";

	const refreshWidget = () => {
		if (currentCtx) updateWidget(currentCtx, crewManager);
	};

	const rebuildPromptCache = (cwd: string) => {
		const { agents } = discoverAgents(cwd);
		cachedPromptSuffix = formatAgentsForPrompt(agents);
	};

	const activateSession = (ctx: ExtensionContext) => {
		currentCtx = ctx;
		crewManager.activateSession(
			ctx.sessionManager.getSessionId(),
			() => ctx.isIdle(),
			pi,
		);
		refreshWidget();
	};

	crewManager.onWidgetUpdate = refreshWidget;

	pi.on("session_start", (_event, ctx) => {
		rebuildPromptCache(ctx.cwd);
		activateSession(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		crewManager.abortForOwner(ctx.sessionManager.getSessionId(), pi);
	});

	pi.on("before_agent_start", (event) => {
		if (!cachedPromptSuffix) return;
		const marker = "\nCurrent date: ";
		const idx = event.systemPrompt.lastIndexOf(marker);
		if (idx === -1) {
			return { systemPrompt: event.systemPrompt + cachedPromptSuffix };
		}
		const before = event.systemPrompt.slice(0, idx);
		const after = event.systemPrompt.slice(idx);
		return { systemPrompt: before + cachedPromptSuffix + after };
	});

	registerCrewIntegration(pi, crewManager);
}
