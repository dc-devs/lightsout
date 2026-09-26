import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/**
 * The folder each `internal/` segment of a path makes the file private to —
 * the folder holding that `internal/`. A path with nested `internal/` folders
 * is private to each of them in turn, and an importer has to be inside all.
 */
const getOwners = ({ path }: { path: string }) => {
	const segments = path.split('/').slice(0, -1);

	return segments.flatMap((segment, index) => (segment === 'internal' ? [segments.slice(0, index).join('/')] : []));
};

const isInside = ({ file, folder }: { file: string; folder: string }) => folder === '' || file.startsWith(`${folder}/`);

/** One file reaching into one folder: every file of that folder's `internal/` it imported. */
interface Crossing {
	from: string;
	owner: string;
	targets: string[];
}

export const check: StandardsCheckModule = {
	inputKind: 'import-graph',
	/**
	 * A file inside an `internal/` folder belongs to the folder that holds it:
	 * only files inside that folder — its tests included — may import it.
	 *
	 * Decided from the two paths alone. Where the files sit is the whole
	 * statement of what is private, so there is no list elsewhere to consult and
	 * none to drift. Every file one importer reaches into one folder's
	 * `internal/` is ONE finding: the fix is a single decision about that
	 * import, whether to move the file out of `internal/` or stop reaching for it.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'import-graph') {
			return [];
		}

		const scope = new Set(input.files);
		const crossings = new Map<string, Crossing>();

		for (const { from, to } of input.edges) {
			if (!scope.has(from)) {
				continue;
			}

			for (const owner of getOwners({ path: to }).filter((folder) => !isInside({ file: from, folder }))) {
				const key = `${from}\0${owner}`;
				const crossing = crossings.get(key) ?? { from, owner, targets: [] };

				crossings.set(key, { ...crossing, targets: crossing.targets.includes(to) ? crossing.targets : [...crossing.targets, to] });
			}
		}

		return [...crossings.values()].map(({ from, owner, targets }) =>
			buildRawFinding({
				rule: 'internal-import-from-outside',
				files: [{ path: from }, ...targets.map((path) => ({ path }))],
				detail: `imports ${targets.map((path) => `'${path}'`).join(', ')} — internal to '${owner}', which '${from}' is outside of`,
				guidance: 'A file under internal/ is private to the folder holding it — move it out of internal/ to share it, or keep the import inside that folder.',
			}),
		);
	},
};
