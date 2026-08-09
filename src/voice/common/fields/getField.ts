interface Params {
	value: unknown;
	key: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

/**
 * One field out of a value nothing has vouched for yet.
 *
 * Transcript entries and tool input arrive as parsed JSON, so every read is two
 * questions before it is one: is this even an object, and does it hold the
 * field. Asking them once here keeps the readers about what they are looking
 * for rather than about how to look.
 */
export const getField = ({ value, key }: Params): unknown => {
	return isRecord(value) ? value[key] : undefined;
};
