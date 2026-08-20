import { posix } from 'node:path';
import type { SpecifierResolver } from '#src/common/types/SpecifierResolver.ts';

interface Params {
	/** Repo-relative files — the universe specifiers resolve against. */
	files: string[];
}

const stripExtension = ({ path }: { path: string }) => path.replace(/\.(m|c)?[jt]sx?$/i, '');

/**
 * One specifier resolver over one file universe, shared by every pass that
 * must agree on what an import points at (edge collection, barrel surfaces).
 * Alias-free by design: no tsconfig, no alias tables — relative specifiers
 * resolve against the importing file's folder, everything else by unique
 * path suffix, and every unresolvable or ambiguous specifier is `undefined`.
 */
export const createSpecifierResolver = ({ files }: Params): SpecifierResolver => {
	const byStripped = new Map<string, string>();

	for (const file of files) {
		byStripped.set(stripExtension({ path: file }), file);
	}

	const probe = ({ stripped }: { stripped: string }) => byStripped.get(stripped) ?? byStripped.get(`${stripped}/index`);

	const resolveRelative = ({ from, specifier }: { from: string; specifier: string }) =>
		probe({ stripped: posix.normalize(posix.join(posix.dirname(from), stripExtension({ path: specifier }))) });

	// Aliased specifiers (`@/x/y`, `@scope/pkg/src/x`) resolve by unique path
	// suffix: drop leading segments one tier at a time; the first tier with
	// exactly one match wins. Multiple matches are ambiguous — no resolution.
	// Single-segment specifiers (external packages like `react`) never reach
	// a matchable tier.
	const resolveBySuffix = ({ specifier }: { specifier: string }) => {
		const segments = stripExtension({ path: specifier }).split('/');

		for (let start = 1; start < segments.length; start += 1) {
			const suffix = segments.slice(start).join('/');
			const matches = [...byStripped.keys()].filter(
				(stripped) => stripped === suffix || stripped.endsWith(`/${suffix}`) || stripped === `${suffix}/index` || stripped.endsWith(`/${suffix}/index`),
			);

			if (matches.length > 1) {
				return undefined;
			}

			if (matches.length === 1 && matches[0] !== undefined) {
				return byStripped.get(matches[0]);
			}
		}

		return undefined;
	};

	return ({ from, specifier }) => (specifier.startsWith('.') ? resolveRelative({ from, specifier }) : resolveBySuffix({ specifier }));
};
