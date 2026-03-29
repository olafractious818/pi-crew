import {
	AuthStorage,
	type CreateAgentSessionResult,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents.js";

type ToolFactory = (
	cwd: string,
) => ReturnType<
	typeof createReadTool |
		typeof createBashTool |
		typeof createEditTool |
		typeof createWriteTool |
		typeof createGrepTool |
		typeof createFindTool |
		typeof createLsTool
>;

const TOOL_FACTORIES: Record<string, ToolFactory> = {
	read: (cwd) => createReadTool(cwd),
	bash: (cwd) => createBashTool(cwd),
	edit: (cwd) => createEditTool(cwd),
	write: (cwd) => createWriteTool(cwd),
	grep: (cwd) => createGrepTool(cwd),
	find: (cwd) => createFindTool(cwd),
	ls: (cwd) => createLsTool(cwd),
};

function isSupportedTool(name: string): name is keyof typeof TOOL_FACTORIES {
	return name in TOOL_FACTORIES;
}

function resolveTools(toolNames: string[] | undefined, cwd: string) {
	const names = toolNames ?? Object.keys(TOOL_FACTORIES);
	return names
		.filter(isSupportedTool)
		.map((name) => TOOL_FACTORIES[name](cwd));
}

function resolveModel(
	agentConfig: AgentConfig,
	ctx: ExtensionContext,
	modelRegistry: ModelRegistry,
) {
	const model = ctx.model;
	if (!agentConfig.parsedModel) return model;

	const found = modelRegistry.find(
		agentConfig.parsedModel.provider,
		agentConfig.parsedModel.modelId,
	);
	if (found) return found;

	console.warn(
		`[pi-crew] Agent "${agentConfig.name}": model "${agentConfig.model}" not found in registry, using default`,
	);
	return model;
}

export interface BootstrapOptions {
	agentConfig: AgentConfig;
	cwd: string;
	ctx: ExtensionContext;
	extensionResolvedPath: string;
	parentSessionFile?: string;
}

export async function bootstrapSession(
	opts: BootstrapOptions,
): Promise<CreateAgentSessionResult> {
	const { agentConfig, cwd, ctx, extensionResolvedPath, parentSessionFile } = opts;

	const authStorage = AuthStorage.create();
	const modelRegistry = new ModelRegistry(authStorage);
	const model = resolveModel(agentConfig, ctx, modelRegistry);
	const tools = resolveTools(agentConfig.tools, cwd);

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		extensionsOverride: (base) => ({
			...base,
			extensions: base.extensions.filter(
				(ext) => !ext.resolvedPath.startsWith(extensionResolvedPath),
			),
		}),
		skillsOverride: agentConfig.skills
			? (base) => ({
					skills: base.skills.filter((s) => agentConfig.skills!.includes(s.name)),
					diagnostics: base.diagnostics,
				})
			: undefined,
		appendSystemPromptOverride: (base) =>
			agentConfig.systemPrompt.trim() ? [...base, agentConfig.systemPrompt] : base,
	});
	await resourceLoader.reload();

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: agentConfig.compaction ?? true },
	});

	const sessionManager = SessionManager.create(cwd);
	sessionManager.newSession({ parentSession: parentSessionFile });

	return createAgentSession({
		cwd,
		model,
		thinkingLevel: agentConfig.thinking,
		tools,
		resourceLoader,
		sessionManager,
		settingsManager,
		authStorage,
		modelRegistry,
	});
}
