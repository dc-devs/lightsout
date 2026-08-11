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
const tokensOf = (name: string): string[] =>
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
 * `to`/`from` token pins word order instead of sorting. Factored out of
 * `checkFilenameDuplicates` (its source of truth) so the standards check and
 * plan-time prior-art detection compare names identically.
 */
export const nameKey = ({ name }: Params): string => {
	const tokens = tokensOf(name);

	return tokens.includes('to') || tokens.includes('from') ? tokens.join(' ') : [...tokens].sort().join(' ');
};
