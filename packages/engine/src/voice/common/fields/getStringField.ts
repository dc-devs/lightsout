import { getField } from '@/voice/common/fields/getField';

interface Params {
	value: unknown;
	key: string;
}

/** One field that has to be text to be worth anything — a label, a type, a line to say out loud. */
export const getStringField = ({ value, key }: Params): string | undefined => {
	const field = getField({ value, key });

	return typeof field === 'string' ? field : undefined;
};
