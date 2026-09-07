interface Params {
	value: unknown;
}

/** Every object's keys in sorted order, at every depth; arrays keep their own order and `undefined` members drop out. */
const canonicalize = ({ value }: { value: unknown }): unknown => {
	if (Array.isArray(value)) {
		return value.map((member: unknown) => canonicalize({ value: member }));
	}

	if (value === null || typeof value !== 'object') {
		return value;
	}

	const named = Object.entries(value).filter(([, member]) => member !== undefined);
	const sorted = named.sort(([left], [right]) => (left > right ? 1 : -1));

	return Object.fromEntries(sorted.map(([key, member]) => [key, canonicalize({ value: member })]));
};

/**
 * A stable JSON encoding: two values that differ only in the order their object
 * keys were written encode identically, while two arrays in different orders do
 * not.
 *
 * It exists because a fingerprint hashed over `JSON.stringify` would move
 * whenever a field was added to an object literal in a different position,
 * reporting an input as changed that nobody touched. Array order is preserved
 * because an ordered list IS its order — a plan's phase files in a different
 * sequence are a different plan.
 */
export const canonicalJson = ({ value }: Params): string =>
	// `undefined` is not representable in JSON, and a fingerprint that encoded it
	// as the empty string could not be told from one over an empty value.
	JSON.stringify(canonicalize({ value })) ?? 'null';
