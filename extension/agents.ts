import * as fs from "node:fs";
import * as path from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export interface ParsedModel {
	provider: string;
	modelId: string;
}

export interface AgentConfig {
	name: string;
	description: string;
	model?: string;
	parsedModel?: ParsedModel;
	thinking?: ThinkingLevel;
	tools?: string[];
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

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
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

/**
 * Converts a comma-separated string or YAML array to string[].
 * Returns undefined for null/undefined input.
 */
export function parseCommaSeparated(value: unknown): string[] | undefined {
	if (value == null) return undefined;

	if (Array.isArray(value)) {
		const items = value.map((v) => String(v).trim()).filter(Boolean);
		return items.length > 0 ? items : undefined;
	}

	if (typeof value === "string") {
		const items = value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		return items.length > 0 ? items : undefined;
	}

	return undefined;
}

/**
 * Parses "provider/model-id" format.
 * Returns null if "/" is missing.
 */
export function parseModel(value: unknown): ParsedModel | null {
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

export function loadAgentFromFile(
	filePath: string,
	onWarning?: (warning: AgentDiscoveryWarning) => void,
): AgentConfig | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(content);
		frontmatter = parsed.frontmatter;
		body = parsed.body;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		onWarning?.({
			filePath,
			message: `Ignored invalid agent definition. Frontmatter could not be parsed: ${reason}`,
		});
		console.warn(
			`[pi-crew] Ignoring agent definition "${filePath}": frontmatter could not be parsed: ${reason}`,
		);
		return null;
	}

	const name = frontmatter.name;
	const description = frontmatter.description;

	if (typeof name !== "string" || !name || typeof description !== "string" || !description) {
		return null;
	}

	if (/\s/.test(name)) {
		onWarning?.({
			filePath,
			message: `Ignored agent definition "${name}". Agent names cannot contain whitespace. Use "-" instead.`,
		});
		console.warn(
			`[pi-crew] Ignoring agent definition "${filePath}": agent name "${name}" contains whitespace. Use "-" instead.`,
		);
		return null;
	}

	const modelRaw = typeof frontmatter.model === "string" ? frontmatter.model : undefined;
	const parsedModel = modelRaw ? parseModel(modelRaw) : undefined;

	if (modelRaw && !parsedModel) {
		onWarning?.({
			filePath,
			message: `Agent "${name}": invalid model format "${modelRaw}" (expected "provider/model-id"), ignoring model field`,
		});
		console.warn(
			`[pi-crew] Agent "${name}": invalid model format "${modelRaw}" (expected "provider/model-id"), ignoring model field`,
		);
	}

	const thinkingRaw = typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined;
	const thinking = validateThinkingLevel(thinkingRaw);

	if (thinkingRaw && !thinking) {
		console.warn(
			`[pi-crew] Agent "${name}": invalid thinking level "${thinkingRaw}", ignoring`,
		);
	}

	const tools = parseCommaSeparated(frontmatter.tools);
	const skills = parseCommaSeparated(frontmatter.skills);

	const compaction = typeof frontmatter.compaction === "boolean" ? frontmatter.compaction : undefined;
	const interactive = typeof frontmatter.interactive === "boolean" ? frontmatter.interactive : undefined;

	return {
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
	};
}

export function discoverAgents(): AgentDiscoveryResult {
	const agentsDir = path.join(getAgentDir(), "agents");

	if (!fs.existsSync(agentsDir)) {
		return { agents: [], warnings: [] };
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	} catch {
		return { agents: [], warnings: [] };
	}

	const agents: AgentConfig[] = [];
	const warnings: AgentDiscoveryWarning[] = [];
	const seenNames = new Map<string, string>();

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(agentsDir, entry.name);
		const agent = loadAgentFromFile(filePath, (warning) => warnings.push(warning));
		if (!agent) continue;

		const existing = seenNames.get(agent.name);
		if (existing) {
			warnings.push({
				filePath,
				message: `Duplicate agent name "${agent.name}" (already defined in ${existing}), skipping`,
			});
			console.warn(
				`[pi-crew] Duplicate agent name "${agent.name}": "${filePath}" conflicts with "${existing}", skipping`,
			);
			continue;
		}

		seenNames.set(agent.name, filePath);
		agents.push(agent);
	}

	return { agents, warnings };
}
