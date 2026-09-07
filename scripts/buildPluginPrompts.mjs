import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Writes each plugin's slash-command routers from its skills, for the
 * pi-family harnesses only.
 *
 * pi and omp list no plugin skills anywhere a user can pick from — a skill is
 * read on demand, not offered. The routers are that missing menu: type `/`
 * and every entry point the plugin offers is there. Claude Code needs no such
 * menu; it already lists every installed skill as its own slash command, so a
 * router beside it would show each entry point twice.
 *
 * The routers live in `prompts/`, and each harness reaches them differently:
 * pi reads `prompts` from the `pi` block in the plugin's package.json; omp
 * treats a marketplace install as a Claude Code plugin and reads the
 * directory named by `slash-commands` in `.claude-plugin/plugin.json`, a key
 * Claude Code itself ignores. Claude Code scans only `commands/`, which no
 * longer exists. The manifest key is checked below, because a router omp
 * cannot find is a router that does not exist.
 *
 * The router files deliberately hold no workflow of their own: each one just
 * routes to the skill it mirrors, which stays the single source of truth. A
 * router that duplicated its skill's steps would be two documents drifting
 * apart, and this factory runs on documents staying in step.
 *
 * Hand-maintaining the mirrors is how they drift, so every prompts directory
 * is generated: one router per SKILL.md under the plugin's skills, stamped
 * with a marker so write mode may prune a router whose skill disappeared. The
 * namespace comes from each plugin's own manifest, so the routers carry the
 * name the catalog installs under. `--check` writes nothing and fails when a
 * committed directory differs from what this would write, which is what keeps
 * them in step. It is wired into `pnpm check`.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every plugin that ships skills: the base engine plugin and the two tracker add-ons. */
const pluginDirs = ['plugin', 'plugin-linear', 'plugin-jira'];
const marker = '<!-- generated:lightsout-prompt -->';
/** Where omp is told to look for the routers, relative to the plugin root — the value `slash-commands` must carry. */
const promptsPath = './prompts';

/** The frontmatter fields a router carries over from its skill: the name, and the description autocomplete shows. Handles the plain single-line form and the folded (`>-`) block some skills use. */
const parseFrontmatter = ({ text }) => {
	const lines = text.split('\n');
	const end = lines.indexOf('---', 1);

	if (lines[0] !== '---' || end === -1) {
		return {};
	}

	const fields = {};
	let blockKey;

	for (const line of lines.slice(1, end)) {
		// inside an indented block: each indented line folds into the value
		if (blockKey !== undefined && (line.startsWith('  ') || line.trim() === '')) {
			const piece = line.trim();

			if (piece !== '') {
				fields[blockKey] = fields[blockKey] === '' ? piece : `${fields[blockKey]} ${piece}`;
			}
			continue;
		}

		blockKey = undefined;

		const match = /^(name|description):(.*)$/.exec(line);

		if (match === null) {
			continue;
		}

		const value = match[2].trim();

		// a folded or literal block indicator starts an indented block; plain text is the value itself
		if (value === '>' || value === '>-' || value === '|' || value === '|-') {
			blockKey = match[1];
			fields[blockKey] = '';
		} else if (value !== '') {
			fields[match[1]] = value;
		}
	}

	return fields;
};

/** A YAML single-quoted scalar, the one quoting form every consumer of these files accepts. */
const quoteScalar = ({ value }) => `'${value.replaceAll("'", "''")}'`;

const routerFor = ({ pluginName, skillName, description }) => `---
description: ${quoteScalar({ value: description })}
---
${marker}

Read \`skill://${skillName}\` — the ${pluginName} \`${skillName}\` skill — and follow it exactly as if the user had invoked it directly.

User input: $ARGUMENTS
`;

/** One plugin's routers: its manifest name plus the router text per skill, keyed by skill name. */
const buildRouters = ({ pluginDir }) => {
	const skillsDir = join(repoRoot, pluginDir, 'skills');
	const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
	const { name: pluginName, 'slash-commands': slashCommands } = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8'));
	const routers = new Map();

	if (slashCommands !== promptsPath) {
		throw new Error(
			`${manifestPath} must set "slash-commands" to "${promptsPath}" — that is how omp finds the routers; it has ${JSON.stringify(slashCommands)}.`,
		);
	}

	for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		const skillPath = join(skillsDir, entry.name, 'SKILL.md');

		if (!existsSync(skillPath)) {
			continue;
		}

		const { name = entry.name, description = '' } = parseFrontmatter({ text: readFileSync(skillPath, 'utf8') });

		routers.set(name, routerFor({ pluginName, skillName: name, description }));
	}

	return { promptsDir: join(repoRoot, pluginDir, 'prompts'), pluginName, routers };
};

/** The names of the generated routers currently on disk for one plugin. */
const onDiskRouterNames = ({ promptsDir }) => {
	if (!existsSync(promptsDir)) {
		return [];
	}

	return readdirSync(promptsDir)
		.filter((file) => file.endsWith('.md') && readFileSync(join(promptsDir, file), 'utf8').includes(marker))
		.map((file) => file.slice(0, -3));
};

/**
 * Exit codes are set rather than forced with `process.exit`, for the reason
 * checkShipped.mjs states: stdout is a pipe for every caller that matters, and
 * exiting on the line after a log discards it.
 */
const main = () => {
	const checking = process.argv.includes('--check');
	const plugins = pluginDirs.map((pluginDir) => buildRouters({ pluginDir }));

	try {
		for (const { promptsDir, pluginName, routers } of plugins) {
			if (!checking) {
				mkdirSync(promptsDir, { recursive: true });

				// only a generated router is ever pruned — a hand-added file is
				// none of this script's business
				for (const stale of onDiskRouterNames({ promptsDir })) {
					rmSync(join(promptsDir, `${stale}.md`));
				}

				for (const [name, text] of routers) {
					writeFileSync(join(promptsDir, `${name}.md`), text);
				}

				console.log(`wrote ${promptsDir.replace(`${repoRoot}/`, '')} (${routers.size} routers)`);

				continue;
			}

			const stale = onDiskRouterNames({ promptsDir });
			const mismatched = [...routers].some(([name, text]) => readFileSync(join(promptsDir, `${name}.md`), 'utf8') !== text);
			const missing = [...routers.keys()].some((name) => !stale.includes(name));

			if (mismatched || missing || stale.length !== routers.size) {
				console.error('');
				console.error(`  ${promptsDir.replace(`${repoRoot}/`, '')} no longer mirrors its skills.`);
				console.error(`  These are the slash commands pi and omp users meet for the ${pluginName} plugin.`);
				console.error('');
				console.error(`    pnpm build:plugin-prompts && git add ${pluginDirs.map((dir) => `${dir}/prompts`).join(' ')}`);
				console.error('');
				process.exitCode = 1;
				return;
			}

			console.log(`${promptsDir.replace(`${repoRoot}/`, '')} matches its skills (${routers.size} routers)`);
		}
	} catch (error) {
		console.error('');
		console.error(`  ${error instanceof Error ? error.message : String(error)}`);
		console.error('');
		process.exitCode = 1;
	}
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	main();
}
