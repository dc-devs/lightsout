/** The banned synonyms the naming document lists, each mapped to the verb it must be written as. */
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

/** camelCase / kebab-case / snake_case split into lowercase word tokens, with every banned synonym collapsed onto its verb. */
const getTokens = ({ name }: { name: string }) =>
	name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[\s\-_.]+/)
		.filter(Boolean)
		.map((token) => token.toLowerCase())
		.map((token) => verbSynonyms[token] ?? token);

interface Params {
	/** An export name, extension already stripped — `getExportName` supplies it. */
	name: string;
}

/**
 * An export name reduced to a synonym- and word-order-normalized key, so
 * `fetchUserData`, `getUserData` and `userDataGet` all collapse onto one
 * string.
 *
 * Conversion names are the one place word order carries meaning — `hexToRgb`
 * and `rgbToHex` are deliberate opposites, not one concept — so a `to` or
 * `from` token pins the order instead of sorting it away.
 */
export const getNameKey = ({ name }: Params): string => {
	const tokens = getTokens({ name });

	return tokens.includes('to') || tokens.includes('from') ? tokens.join(' ') : [...tokens].sort().join(' ');
};
