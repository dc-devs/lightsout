import type { ImportTarget } from '../types/ImportTarget.ts';
import type { PathAliases } from '../types/PathAliases.ts';
import { getDirectory } from './getDirectory.ts';
import { joinPath } from './joinPath.ts';

/**
 * Extensions probed in the order a bundler would: the file itself, then the
 * folder's barrel.
 *
 * The specifier is tried unchanged first, because `allowImportingTsExtensions`
 * lets a specifier carry its own `.ts` — which is the form Node's type
 * stripping needs, and therefore the form a standards package's own checks are
 * written in. Probed only by appending, `./CloneSpan.ts` becomes a search for
 * `CloneSpan.ts.ts`, and the barrel that used it reads as unresolvable.
 */
const findFile = ({ base, files }: { base: string; files: Set<string> }): string | undefined =>
	[base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => files.has(candidate));

/**
 * The one place a probe becomes an answer.
 *
 * Both ways of naming a local file — a relative path and an alias — end here,
 * so what "the run never listed it" means is written once. Spelled out per
 * branch instead, the two copies drift the first time a fourth answer is added.
 */
const fromProbe = ({ found }: { found: string | undefined }): ImportTarget => (found === undefined ? { kind: 'unknown' } : { kind: 'file', path: found });

/**
 * The portion of a specifier a wildcard pattern captures, or undefined when the
 * pattern does not match it.
 *
 * A pattern with no `*` matches only exactly, and captures nothing — which is
 * how TypeScript reads it too.
 */
const capture = ({ pattern, specifier }: { pattern: string; specifier: string }): string | undefined => {
	const star = pattern.indexOf('*');

	if (star === -1) {
		return pattern === specifier ? '' : undefined;
	}

	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);

	return specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)
		? specifier.slice(prefix.length, specifier.length - suffix.length)
		: undefined;
};

/**
 * A specifier shaped like something the package manager could install: a
 * builtin, a bare name, or a scoped name, each with an optional subpath.
 *
 * The point is what it excludes. `@/agents/x` has an empty scope, `~/foo` and
 * `#internal/foo` start with characters no package name may — none of the three
 * could ever be installed, so each is an alias whose mapping this run does not
 * have, not a dependency.
 */
const isPackageSpecifier = ({ specifier }: { specifier: string }): boolean =>
	/^node:|^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/|$)/.test(specifier);

/**
 * The alias entry that claims a specifier, longest prefix first — TypeScript's
 * own precedence, so `@/common/*` wins over `@/*` for `@/common/utils/x`.
 */
const matchAlias = ({ aliases, specifier }: { aliases: PathAliases; specifier: string }) =>
	[...aliases.patterns]
		.map(([pattern, targets]) => ({ targets, captured: capture({ pattern, specifier }) }))
		.filter((entry): entry is { targets: string[]; captured: string } => entry.captured !== undefined)
		.sort((first, second) => first.captured.length - second.captured.length)[0];

interface Params {
	/** Repo-relative path of the file the specifier is written in — its folder anchors a relative specifier. */
	from: string;
	/** The module specifier exactly as written. */
	specifier: string;
	/** Every file in scope — the universe a specifier resolves against. */
	files: Set<string>;
	/**
	 * The importing package's path aliases, or undefined when they could not be
	 * determined. Undefined is not "there are none": it makes every non-relative
	 * specifier `unknown`, because an alias and a published package are written
	 * the same way and only this map tells them apart.
	 */
	aliases: PathAliases | undefined;
}

/**
 * What a module specifier points at: a file in scope, a published package, or
 * an answer this run cannot give.
 *
 * The third case is the one that matters. Every barrel in a package that
 * imports through an alias resolves to nothing until the alias map is in hand,
 * and a rule that reads "nothing" as "this barrel exports no files" will report
 * every file in the package as private. Saying `unknown` instead lets each rule
 * decide, and the safe decision — stay silent — is then available to make.
 */
export const resolveImport = ({ from, specifier, files, aliases }: Params): ImportTarget => {
	// A relative specifier always named a local file, whatever the aliases say.
	if (specifier.startsWith('.')) {
		return fromProbe({ found: findFile({ base: joinPath({ from: getDirectory({ path: from }), specifier }), files }) });
	}

	if (aliases === undefined) {
		return { kind: 'unknown' };
	}

	const matched = matchAlias({ aliases, specifier });

	// No alias in the tsconfig claims it. That is only proof it is a package when
	// the specifier could BE one — an alias configured somewhere the tsconfig does
	// not reach (a bundler's own resolve.alias, a jsconfig) is still a local file,
	// and calling it external would leave the barrel looking fully read while a
	// file it exports looked private.
	if (matched === undefined) {
		return isPackageSpecifier({ specifier }) ? { kind: 'external' } : { kind: 'unknown' };
	}

	const bases = matched.targets.map((target) => joinPath({ from: aliases.base, specifier: target.replace('*', matched.captured) }));

	return fromProbe({ found: bases.map((base) => findFile({ base, files })).find((candidate) => candidate !== undefined) });
};
