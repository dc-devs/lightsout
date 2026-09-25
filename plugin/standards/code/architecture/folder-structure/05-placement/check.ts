import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { collectPublishedFiles } from '../../../../common/modules/collectPublishedFiles.ts';
import { getDirectory } from '../../../../common/paths/getDirectory.ts';
import { isBarrelFile } from '../../../../common/paths/isBarrelFile.ts';

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

/**
 * The files each module's barrel publishes, keyed by the module's folder. A
 * barrel holds only re-export lines, so the edges leaving it are its surface.
 */
const mapPublishedByOwner = ({ edges }: { edges: Array<{ from: string; to: string }> }) => {
	const targetsByFile = new Map<string, Set<string>>();

	for (const { from, to } of edges) {
		targetsByFile.set(from, (targetsByFile.get(from) ?? new Set<string>()).add(to));
	}

	const published = new Map<string, Set<string>>();

	for (const barrelPath of [...targetsByFile.keys()].filter((file) => isBarrelFile({ path: file }))) {
		const owner = getDirectory({ path: barrelPath });

		published.set(owner, new Set([...(published.get(owner) ?? []), ...collectPublishedFiles({ barrelPath, targetsByFile })]));
	}

	return published;
};

/** Each leaked file with the module that owns it and everyone outside reaching in. */
const getLeaks = ({ edges }: { edges: Array<{ from: string; to: string }> }) => {
	const leaks = new Map<string, { owner: string; consumers: Set<string> }>();
	const publishedByOwner = mapPublishedByOwner({ edges });

	for (const { from, to } of edges) {
		const owner = getCommonOwner({ path: to });

		// No owner, or a package/repo-root common (shared by design), or an
		// importer inside the owner (using its own common) — none is a leak.
		if (owner === undefined || owner.split('/').pop() === 'src' || from.startsWith(`${owner}/`)) {
			continue;
		}

		// A file the owner's barrel publishes is part of the module's public API
		// — a type its exported functions take, say — so an outside importer
		// naming it is using that API, not reaching past it.
		if (publishedByOwner.get(owner)?.has(to) === true) {
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
	// lowest common ancestor's `common/` — unless the module's barrel publishes
	// it, which makes it part of the module's public API. Duplicate and promotion-candidate
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
