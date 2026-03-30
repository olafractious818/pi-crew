import * as fs from "node:fs";
import * as path from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { type SupportedToolName, isSupportedToolName } from "./tool-registry.js";

interface ParsedModel {
	provider: string;
	modelId: string;
}

export interface AgentConfig {
	name: string;
	description: string;
	model?: string;
	parsedModel?: ParsedModel;
	thinking?: ThinkingLevel;
	tools?: SupportedToolName[];
	skills?: string[];
	compaction?: boolean;
	interactive?: boolean;
	systemPrompt: string;
	filePath: string;
}

export interface AgentDiscoveryWarning {
	filePath: string;
	message: string;
}

interface AgentDiscoveryResult {
	agents: AgentConfig[];
	warnings: AgentDiscoveryWarning[];
}

interface ParseResult {
	agent: AgentConfig | null;
	warnings: AgentDiscoveryWarning[];
}

interface FileLoadResult {
	content: string | null;
	warnings: AgentDiscoveryWarning[];
}

interface DirectoryLoadResult {
	filePaths: string[];
	warnings: AgentDiscoveryWarning[];
}

const VALID_THINKING_LEVELS: readonly string[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

function createDiscoveryWarning(filePath: string, message: string): AgentDiscoveryWarning {
	return { filePath, message };
}

/**
 * Converts a comma-separated string or YAML array to string[].
 * Returns undefined for null/undefined input.
 */
function parseCommaSeparated(value: unknown): string[] | undefined {
	if (value == null) return undefined;

	if (Array.isArray(value)) {
		return value.map((v) => String(v).trim()).filter(Boolean);
	}

	if (typeof value === "string") {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	return undefined;
}

function parseListField(
	fieldName: "tools" | "skills",
	value: unknown,
	filePath: string,
	agentName: string,
): { values: string[]; warnings: AgentDiscoveryWarning[] } {
	if (value == null) return { values: [], warnings: [] };

	const parsed = parseCommaSeparated(value);
	if (parsed !== undefined) return { values: parsed, warnings: [] };

	return {
		values: [],
		warnings: [
			createDiscoveryWarning(
				filePath,
				`Subagent "${agentName}": invalid ${fieldName} field, expected a comma-separated string or YAML array`,
			),
		],
	};
}

/**
 * Parses "provider/model-id" format.
 * Returns null if "/" is missing.
 */
function parseModel(value: unknown): ParsedModel | null {
	if (typeof value !== "string" || !value.includes("/")) {
		return null;
	}

	const slashIndex = value.indexOf("/");
	const provider = value.slice(0, slashIndex).trim();
	const modelId = value.slice(slashIndex + 1).trim();

	if (!provider || !modelId) return null;

	return { provider, modelId };
}

function validateThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) return undefined;
	if (VALID_THINKING_LEVELS.includes(value)) return value as ThinkingLevel;
	return undefined;
}

export function parseAgentDefinition(content: string, filePath: string): ParseResult {
	const warnings: AgentDiscoveryWarning[] = [];

	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(content);
		frontmatter = parsed.frontmatter;
		body = parsed.body;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			agent: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored invalid subagent definition. Frontmatter could not be parsed: ${reason}`,
				),
			],
		};
	}

	const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : undefined;
	const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : undefined;

	if (!name || !description) {
		return {
			agent: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					'Ignored invalid subagent definition. Required frontmatter fields "name" and "description" must be non-empty strings.',
				),
			],
		};
	}

	if (/\s/.test(name)) {
		return {
			agent: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored subagent definition "${name}". Subagent names cannot contain whitespace. Use "-" instead.`,
				),
			],
		};
	}

	const modelRaw = typeof frontmatter.model === "string" ? frontmatter.model : undefined;
	const parsedModel = modelRaw ? parseModel(modelRaw) : undefined;
	if (modelRaw && !parsedModel) {
		warnings.push(
			createDiscoveryWarning(
				filePath,
				`Subagent "${name}": invalid model format "${modelRaw}" (expected "provider/model-id"), ignoring model field`,
			),
		);
	}

	const thinkingRaw = typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined;
	const thinking = validateThinkingLevel(thinkingRaw);
	if (thinkingRaw && !thinking) {
		warnings.push(
			createDiscoveryWarning(
				filePath,
				`Subagent "${name}": invalid thinking level "${thinkingRaw}", ignoring`,
			),
		);
	}

	const toolsField = "tools" in frontmatter
		? parseListField("tools", frontmatter.tools, filePath, name)
		: undefined;
	const rawTools = toolsField?.values;
	if (toolsField) warnings.push(...toolsField.warnings);
	const invalidTools = rawTools?.filter((toolName) => !isSupportedToolName(toolName)) ?? [];
	if (invalidTools.length > 0) {
		warnings.push(
			createDiscoveryWarning(
				filePath,
				`Subagent "${name}": unknown tools ${invalidTools.map((toolName) => `"${toolName}"`).join(", ")}, ignoring`,
			),
		);
	}
	const tools = rawTools?.filter(isSupportedToolName) ?? undefined;

	const skillsField = "skills" in frontmatter
		? parseListField("skills", frontmatter.skills, filePath, name)
		: undefined;
	if (skillsField) warnings.push(...skillsField.warnings);
	const skills = skillsField?.values ?? undefined;

	const compaction = typeof frontmatter.compaction === "boolean" ? frontmatter.compaction : undefined;
	const interactive = typeof frontmatter.interactive === "boolean" ? frontmatter.interactive : undefined;

	return {
		agent: {
			name,
			description,
			model: modelRaw,
			parsedModel: parsedModel ?? undefined,
			thinking,
			tools,
			skills,
			compaction,
			interactive,
			systemPrompt: body,
			filePath,
		},
		warnings,
	};
}

function loadAgentFile(filePath: string): FileLoadResult {
	try {
		return {
			content: fs.readFileSync(filePath, "utf-8"),
			warnings: [],
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			content: null,
			warnings: [
				createDiscoveryWarning(
					filePath,
					`Ignored subagent definition. File could not be read: ${reason}`,
				),
			],
		};
	}
}

function loadAgentDefinitionFromFile(filePath: string): ParseResult {
	const file = loadAgentFile(filePath);
	if (!file.content) {
		return { agent: null, warnings: file.warnings };
	}

	const parsed = parseAgentDefinition(file.content, filePath);
	return {
		agent: parsed.agent,
		warnings: [...file.warnings, ...parsed.warnings],
	};
}

function loadAgentDefinitionFiles(agentsDir: string): DirectoryLoadResult {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			filePaths: [],
			warnings: [
				createDiscoveryWarning(
					agentsDir,
					`Subagent directory could not be read: ${reason}`,
				),
			],
		};
	}

	return {
		filePaths: entries
			.filter((entry) => entry.name.endsWith(".md"))
			.filter((entry) => entry.isFile() || entry.isSymbolicLink())
			.map((entry) => path.join(agentsDir, entry.name)),
		warnings: [],
	};
}

export function discoverAgents(): AgentDiscoveryResult {
	const agentsDir = path.join(getAgentDir(), "agents");
	if (!fs.existsSync(agentsDir)) {
		return { agents: [], warnings: [] };
	}

	const fileLoad = loadAgentDefinitionFiles(agentsDir);
	const agents: AgentConfig[] = [];
	const warnings: AgentDiscoveryWarning[] = [...fileLoad.warnings];
	const seenNames = new Map<string, string>();

	for (const filePath of fileLoad.filePaths) {
		const loaded = loadAgentDefinitionFromFile(filePath);
		warnings.push(...loaded.warnings);
		if (!loaded.agent) continue;

		const existing = seenNames.get(loaded.agent.name);
		if (existing) {
			warnings.push(
				createDiscoveryWarning(
					filePath,
					`Duplicate subagent name "${loaded.agent.name}" (already defined in ${existing}), skipping`,
				),
			);
			continue;
		}

		seenNames.set(loaded.agent.name, filePath);
		agents.push(loaded.agent);
	}

	return { agents, warnings };
}
