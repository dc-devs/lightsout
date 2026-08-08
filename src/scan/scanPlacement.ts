import { dirname } from 'node:path';
import type ts from 'typescript';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { collectImportEdges } from '@/common/utils/collectImportEdges';

/** The module that owns a common file: everything before its LAST `common` segment. */
const commonOwner = (path: string) => {
	const segments = path.split('/');
	const index = segments.lastIndexOf('common');

	return index <= 0 ? undefined : segments.slice(0, index).join('/');
};

/** Lowest common ancestor directory of the given paths (empty when they share no leading segment). */
const lowestCommonAncestor = (paths: string[]) => {
	const split = paths.map((path) => path.split('/'));
	const shared: string[] = [];

	for (let index = 0; ; index += 1) {
		const segment = split[0]?.[index];

		if (segment === undefined || !split.every((parts) => parts[index] === segment)) {
			break;
		}

		shared.push(segment);
	}

	return shared.join('/');
};

interface Params {
	cwd: string;
	/** Repo-relative source files, TESTS INCLUDED — a test reaching into a module's common leaks the boundary too. */
	files: string[];
	compiler: typeof ts;
}

/**
 * Placement detector: a file under `<module>/common/…` is module-internal
 * shared code; when an importer OUTSIDE that module reaches into it, the
 * standards' fix is promotion to the lowest common ancestor's `common/`.
 * Package/repo `src`-root common is shared by design and never a leak. This
 * is the only check here — duplicate/promotion-candidate detection already
 * lives in the filename-duplicate and AST tiers. Not gating: the fix is a
 * file move, so it informs the work-list rather than blocking. Runs only when
 * TypeScript resolves (import resolution required).
 */
export const scanPlacement = async ({ cwd, files, compiler }: Params): Promise<StandardsFinding[]> => {
	const edges = await collectImportEdges({ cwd, files, compiler });
	const leaksByFile = new Map<string, { owner: string; consumers: Set<string> }>();

	for (const { from, to } of edges) {
		const owner = commonOwner(to);

		// No owner, or a package/repo-root common (shared by design), or an
		// importer inside the owner (using its own common) — none is a leak.
		if (owner === undefined || owner.split('/').pop() === 'src' || from.startsWith(`${owner}/`)) {
			continue;
		}

		// The owner is carried rather than recomputed below: it is already proven
		// to exist by the guard above, and asking twice would mean guarding twice.
		leaksByFile.set(to, { owner, consumers: (leaksByFile.get(to)?.consumers ?? new Set()).add(from) });
	}

	const findings: StandardsFinding[] = [];

	for (const [file, { owner, consumers: consumerSet }] of leaksByFile) {
		const consumers = [...consumerSet].sort();
		const lca = lowestCommonAncestor([owner, ...consumers.map((consumer) => dirname(consumer))]);

		findings.push({
			rule: StandardsRule.Placement,
			severity: StandardsSeverity.Finding,
			siteKey: `placement:${file}`,
			files: [{ path: file }, ...consumers.map((path) => ({ path }))],
			detail: `'${file}' is internal to module '${owner}' (under its common/) but imported by ${consumers.join(', ')} — promote to ${lca}/common/`,
			guidance: 'Shared code belongs in the common/ of the lowest folder that contains everyone using it.',
		});
	}

	return findings;
};
