import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';

const sourceExtension = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** One casing of a colliding name: how to print it, and a real file to anchor the finding to. */
interface Variant {
	display: string;
	representative: string;
}

/**
 * Every sibling-name collision in the tree, keyed by parent folder and
 * lowercased name. A file's stem joins the comparison alongside its full name,
 * because module resolution reads `Gates.ts` and `gates/` as the same
 * specifier — the collision the full names alone would miss.
 */
const collectCollisions = ({ files }: { files: string[] }) => {
	const byParent = new Map<string, Map<string, Map<string, Variant>>>();
	const add = ({ parent, key, casing, display, representative }: { parent: string; key: string; casing: string; display: string; representative: string }) => {
		const keys = byParent.get(parent) ?? new Map<string, Map<string, Variant>>();
		const variants = keys.get(key) ?? new Map<string, Variant>();

		byParent.set(parent, keys);
		keys.set(key, variants);

		if (!variants.has(casing)) {
			variants.set(casing, { display, representative });
		}
	};

	for (const file of files) {
		const segments = file.split('/');

		segments.forEach((segment, index) => {
			const parent = segments.slice(0, index).join('/');
			const isFile = index === segments.length - 1;
			const display = isFile ? segment : `${segment}/`;

			add({ parent, key: segment.toLowerCase(), casing: segment, display, representative: file });

			if (isFile && sourceExtension.test(segment)) {
				const stem = segment.replace(sourceExtension, '');

				add({ parent, key: stem.toLowerCase(), casing: stem, display, representative: file });
			}
		});
	}

	return byParent;
};

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// The verdict is in the paths alone: two casings under one lowercased name
	// mean case-insensitive and case-sensitive filesystems see different trees.
	run: ({ input }): RawStandardsFinding[] => {
		const { files } = readPathLists({ input });
		const findings: RawStandardsFinding[] = [];

		for (const [parent, keys] of [...collectCollisions({ files })].sort(([first], [second]) => (first < second ? -1 : 1))) {
			for (const [, variants] of [...keys].sort(([first], [second]) => (first < second ? -1 : 1))) {
				if (variants.size > 1) {
					const sorted = [...variants.values()].sort((first, second) => (first.display < second.display ? -1 : 1));

					findings.push(
						buildRawFinding({
							rule: 'case-collision',
							files: [...new Set(sorted.map(({ representative }) => representative))].sort().map((path) => ({ path })),
							detail: `${sorted.map(({ display }) => `'${display}'`).join(', ')} differ only by casing in ${parent === '' ? 'the repo root' : parent}`,
							guidance:
								'A case-insensitive filesystem resolves these to one entry, a case-sensitive one to two — rename one side so every machine sees the same tree.',
						}),
					);
				}
			}
		}

		return findings;
	},
};
