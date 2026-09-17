import type { AttachmentManifest } from '#src/common/types/AttachmentManifest.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';

interface Params {
	text: string;
	/** The marker's own attachment title, spelled into every refusal. */
	markerName: string;
	/** Which bare file names this generation may carry. */
	isAllowedName: (params: { name: string }) => boolean;
}

/**
 * Parse and validate an untrusted commit marker before any listed asset is
 * selected.
 *
 * The marker title and the allowed file names are the caller's, because they
 * are the only two things a plan generation and a brainstorm generation differ
 * by — everything else here is the same refusal in the same order.
 */
export const parseAttachmentManifest = ({ text, markerName, isAllowedName }: Params): { manifest: AttachmentManifest } | { error: string } => {
	let value: unknown;

	try {
		value = JSON.parse(text);
	} catch (error) {
		return { error: `${markerName} is not valid JSON: ${messageOf({ error })}` };
	}

	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { error: `${markerName} must contain an object` };
	}

	const candidate = value as { schemaVersion?: unknown; files?: unknown };

	if (candidate.schemaVersion !== 1) {
		return { error: `${markerName} has unsupported schemaVersion ${JSON.stringify(candidate.schemaVersion)} — expected 1` };
	}

	if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
		return { error: `${markerName} must list at least one durable plan file` };
	}

	const files: AttachmentManifest['files'] = [];

	for (const entry of candidate.files) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			return { error: `${markerName} contains a file entry that is not an object` };
		}

		const file = entry as { name?: unknown; sha256?: unknown };

		if (typeof file.name !== 'string' || !isAllowedName({ name: file.name })) {
			return { error: `${markerName} contains a non-durable or unsafe file name: ${JSON.stringify(file.name)}` };
		}

		if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
			return { error: `${markerName} contains an invalid SHA-256 for ${file.name}` };
		}

		if (files.some(({ name }) => name === file.name)) {
			return { error: `${markerName} lists ${file.name} more than once` };
		}

		files.push({ name: file.name, sha256: file.sha256 });
	}

	return { manifest: { schemaVersion: 1, files } };
};
