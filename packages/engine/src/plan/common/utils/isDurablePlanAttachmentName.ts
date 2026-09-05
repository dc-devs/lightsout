import { basename } from 'node:path';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';

/** Attachment titles are untrusted; only bare durable plan file names may enter a transport generation. */
export const isDurablePlanAttachmentName = ({ name }: { name: string }): boolean =>
	name === basename(name) &&
	name !== '.' &&
	name !== '..' &&
	!/[\\/]/.test(name) &&
	(durablePlanFileNames.records.includes(name) || durablePlanFileNames.deliverable.test(name));
