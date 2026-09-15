import { sha256 } from '#src/common/utils/sha256.ts';

interface Params {
	id: string;
}

/** Opaque receipt IDs resolve only inside an engine-reserved immutable artifact namespace. */
export const planningResultReceiptPath = ({ id }: Params): string => `planning-results/${sha256({ content: id })}.json`;
