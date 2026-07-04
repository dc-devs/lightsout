import { basename } from 'node:path';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';

/** Synonym verbs collapse to one canonical form — synonyms are how duplicates hide from name search. */
const verbSynonyms: Record<string, string> = {
	fetch: 'get',
	load: 'get',
	retrieve: 'get',
	read: 'get',
	make: 'create',
	generate: 'create',
	produce: 'create',
	remove: 'delete',
	modify: 'update',
	verify: 'validate',
	check: 'validate',
};

const nameOf = (path: string) => basename(path).replace(/\.(m|c)?[jt]sx?$/, '');

/** camelCase / kebab-case / snake_case → lowercase word tokens, synonyms collapsed. */
const tokensOf = (name: string) =>
	name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[\s\-_.]+/)
		.filter(Boolean)
		.map((token) => token.toLowerCase())
		.map((token) => verbSynonyms[token] ?? token);

interface Params {
	/** Repo-relative non-test source files. */
	files: string[];
}

/**
 * Tier 0 of the duplication ladder: one-export-per-file makes filenames
 * export names, so name-level comparison is nearly free and runs before any
 * AST work. Two findings: the same name declared in multiple places, and
 * names identical after synonym-collapse + word-order normalization
 * (`fetchUserData` vs `getUserData` vs `userDataGet`). Advisory — same-name
 * siblings can be legitimate (per-package analogs).
 */
export const scanFilenameDuplicates = ({ files }: Params) => {
	const findings: ScanFinding[] = [];
	const byName = new Map<string, string[]>();
	const byTokens = new Map<string, Map<string, string[]>>();

	for (const file of files) {
		const name = nameOf(file);

		if (name === 'index') {
			continue;
		}

		byName.set(name, [...(byName.get(name) ?? []), file]);

		// Conversion names are order-sensitive: hexToRgb and rgbToHex are
		// deliberate opposites, not one concept — sorting would collapse them.
		const tokens = tokensOf(name);
		const key = tokens.includes('to') || tokens.includes('from') ? tokens.join(' ') : [...tokens].sort().join(' ');
		const group = byTokens.get(key) ?? new Map<string, string[]>();

		group.set(name, [...(group.get(name) ?? []), file]);
		byTokens.set(key, group);
	}

	for (const [name, paths] of byName) {
		if (paths.length > 1) {
			findings.push({
				detector: ScanDetector.FilenameDuplicate,
				severity: ScanSeverity.Advisory,
				cluster: `name:${name}`,
				files: paths.map((path) => ({ path })),
				detail: `'${name}' is declared in ${paths.length} places — same concept implemented twice, or a promotion candidate`,
			});
		}
	}

	for (const [key, group] of byTokens) {
		if (group.size > 1) {
			const names = [...group.keys()];
			const paths = [...group.values()].flat();

			// Names identical up to casing/separators (`GetStarted` vs
			// `get-started`) are a framework pair (component + kebab route),
			// not a synonym clash.
			if (new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''))).size < 2) {
				continue;
			}

			findings.push({
				detector: ScanDetector.FilenameDuplicate,
				severity: ScanSeverity.Advisory,
				cluster: `tokens:${key}`,
				files: paths.map((path) => ({ path })),
				detail: `${names.map((name) => `'${name}'`).join(', ')} differ only by synonym or word order — likely one concept under two names`,
			});
		}
	}

	return findings;
};
