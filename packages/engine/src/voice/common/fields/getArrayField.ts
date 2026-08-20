import { getField } from '#src/voice/common/fields/getField.ts';

interface Params {
	value: unknown;
	key: string;
}

/** One field that has to be a list to be worth walking. Anything else reads as an empty one, so callers never branch on shape. */
export const getArrayField = ({ value, key }: Params): unknown[] => {
	const field = getField({ value, key });

	return Array.isArray(field) ? field : [];
};
