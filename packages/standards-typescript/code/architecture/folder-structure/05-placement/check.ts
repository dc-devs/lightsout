import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { getDirectory } from '../../../../common/utils/getDirectory.ts';

/** The module that owns a common file: everything before its LAST `common` segment. */
const getCommonOwner = ({ path }: { path: string }) => {
	const segments = path.split('/');
	const index = segments.lastIndexOf('common');

	return index <= 0 ? undefined : segments.slice(0, index).join('/');
};

/** Lowest common ancestor directory of the given paths (empty when they share no leading segment). */
const getLowestCommonAncestor = ({ paths }: { paths: string[] }) => {
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

/** Each leaked file with the module that owns it and everyone outside reaching in. */
const getLeaks = ({ edges }: { edges: Array<{ from: string; to: string }> }) => {
	const leaks = new Map<string, { owner: string; consumers: Set<string> }>();

	for (const { from, to } of edges) {
		const owner = getCommonOwner({ path: to });

		// No owner, or a package/repo-root common (shared by design), or an
		// importer inside the owner (using its own common) — none is a leak.
		if (owner === undefined || owner.split('/').pop() === 'src' || from.startsWith(`${owner}/`)) {
			continue;
		}

		// The owner is carried rather than recomputed below: it is already proven
		// to exist by the guard above, and asking twice would mean guarding twice.
		leaks.set(to, { owner, consumers: (leaks.get(to)?.consumers ?? new Set<string>()).add(from) });
	}

	return leaks;
};

export const check: StandardsCheckModule = {
	inputKind: 'import-graph',
	// A file under `<module>/common/…` is module-internal shared code; when an
	// importer OUTSIDE that module reaches into it, the fix is promotion to the
	// lowest common ancestor's `common/`. Duplicate and promotion-candidate
	// detection belong to the name and token rules — this one is only about the
	// boundary the import crosses.
	run: ({ input }): RawStandardsFinding[] => {
		const edges = input.kind === 'import-graph' ? input.edges : [];

		return [...getLeaks({ edges })].map(([file, { owner, consumers: consumerSet }]) => {
			const consumers = [...consumerSet].sort();
			const ancestor = getLowestCommonAncestor({ paths: [owner, ...consumers.map((consumer) => getDirectory({ path: consumer }))] });

			return buildRawFinding({
				rule: 'placement',
				files: [{ path: file }, ...consumers.map((path) => ({ path }))],
				detail: `'${file}' is internal to module '${owner}' (under its common/) but imported by ${consumers.join(', ')} — promote to ${ancestor}/common/`,
				guidance: 'Shared code belongs in the common/ of the lowest folder that contains everyone using it.',
			});
		});
	},
};
