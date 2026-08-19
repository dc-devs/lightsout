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

/** camelCase / kebab-case / snake_case → lowercase word tokens, synonyms collapsed. */
const getTokens = ({ name }: { name: string }) =>
	name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[\s\-_.]+/)
		.filter(Boolean)
		.map((token) => token.toLowerCase())
		.map((token) => verbSynonyms[token] ?? token);

interface Params {
	/** An export name (extension already stripped, e.g. via `nameOf`). */
	name: string;
}

/**
 * The tier-0 duplication comparator: an export name reduced to a synonym- and
 * word-order-normalized token string, so `fetchUserData`, `getUserData`, and
 * `userDataGet` collapse to one key. Conversion names are order-sensitive —
 * `hexToRgb` and `rgbToHex` are deliberate opposites, not one concept — so a
 * `to`/`from` token pins word order instead of sorting.
 *
 * A deliberate mirror of `getNameKey` in the default standards package, kept
 * identical so plan-time prior-art detection and the `name-synonym` rule never
 * disagree about whether two names are one concept. Neither copy can import
 * the other: a standards package ships as a bare directory beside the engine,
 * with no manifest and no `node_modules`, so every value it imports has to
 * resolve inside its own tree — and the engine runs against whatever package
 * `standardsPackages` names, so it cannot reach into the default one. Change
 * one, change the other.
 */
export const nameKey = ({ name }: Params): string => {
	const tokens = getTokens({ name });

	return tokens.includes('to') || tokens.includes('from') ? tokens.join(' ') : [...tokens].sort().join(' ');
};
