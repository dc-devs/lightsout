import { createHash } from 'node:crypto';

interface Params {
	content: Buffer | string;
}

/**
 * The one content hash the engine uses for file identity — plan attachments
 * published to a ticket, and the ledger test files a run locks against its own
 * executor. Both ask the same question: are these the bytes I recorded?
 */
export const sha256 = ({ content }: Params): string => createHash('sha256').update(content).digest('hex');
