import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CrewManager } from "./runner.js";
import { registerCrewSurface } from "./tools.js";
import { updateWidget } from "./widget.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
	const crewManager = new CrewManager(extensionDir);
	let currentCtx: ExtensionContext | undefined;

	const refreshWidget = () => {
		if (currentCtx) updateWidget(currentCtx, crewManager);
	};

	crewManager.onWidgetUpdate = refreshWidget;
	crewManager.isIdle = () => currentCtx?.isIdle() ?? true;

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		refreshWidget();
	});

	pi.on("session_switch", (_event, ctx) => {
		currentCtx = ctx;
		refreshWidget();
	});

	pi.on("session_shutdown", () => {
		crewManager.abortAll(pi);
	});

	registerCrewSurface(pi, crewManager);
}
