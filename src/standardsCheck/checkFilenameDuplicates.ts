import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { collapseCasing } from '@/common/naming/collapseCasing';
import { nameKey } from '@/common/naming/nameKey';
import { nameOf } from '@/common/naming/nameOf';

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
export const checkFilenameDuplicates = ({ files }: Params): StandardsFinding[] => {
	const findings: StandardsFinding[] = [];
	const byName = new Map<string, string[]>();
	const byTokens = new Map<string, Map<string, string[]>>();

	for (const file of files) {
		const name = nameOf(file);

		if (name === 'index') {
			continue;
		}

		byName.set(name, [...(byName.get(name) ?? []), file]);

		// Conversion names are order-sensitive: hexToRgb and rgbToHex are
		// deliberate opposites, not one concept — the comparator's to/from guard
		// keeps sorting from collapsing them.
		const key = nameKey({ name });
		const group = byTokens.get(key) ?? new Map<string, string[]>();

		group.set(name, [...(group.get(name) ?? []), file]);
		byTokens.set(key, group);
	}

	for (const [name, paths] of byName) {
		if (paths.length > 1) {
			findings.push({
				rule: StandardsRule.FilenameDuplicate,
				severity: StandardsSeverity.Advisory,
				siteKey: `name:${name}`,
				files: paths.map((path) => ({ path })),
				detail: `'${name}' is declared in ${paths.length} places`,
				guidance: 'One concept implemented twice, or a promotion candidate.',
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
			if (new Set(names.map((name) => collapseCasing(name))).size < 2) {
				continue;
			}

			findings.push({
				rule: StandardsRule.FilenameDuplicate,
				severity: StandardsSeverity.Advisory,
				siteKey: `tokens:${key}`,
				files: paths.map((path) => ({ path })),
				detail: `${names.map((name) => `'${name}'`).join(', ')} differ only by synonym or word order`,
				guidance: 'Likely one concept living under two names.',
			});
		}
	}

	return findings;
};
