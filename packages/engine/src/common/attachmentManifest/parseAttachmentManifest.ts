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

	const candidate = {
		schemaVersion: 'schemaVersion' in value ? value.schemaVersion : undefined,
		files: 'files' in value ? value.files : undefined,
		planningGeneration: 'planningGeneration' in value ? value.planningGeneration : undefined,
		brainstormGeneration: 'brainstormGeneration' in value ? value.brainstormGeneration : undefined,
	};

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

		const file = { name: 'name' in entry ? entry.name : undefined, sha256: 'sha256' in entry ? entry.sha256 : undefined };

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

	if (candidate.planningGeneration !== undefined) {
		if (typeof candidate.planningGeneration !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.planningGeneration))
			return { error: `${markerName} has an invalid planning generation` };
		if (!files.some((file) => file.name === 'planning-record.json')) return { error: `${markerName} requires its canonical planning-record.json` };
	}
	if (candidate.brainstormGeneration !== undefined) {
		if (
			candidate.planningGeneration !== undefined ||
			typeof candidate.brainstormGeneration !== 'string' ||
			!/^[a-f0-9]{64}$/.test(candidate.brainstormGeneration)
		)
			return { error: `${markerName} has an invalid brainstorm generation` };
		if (!files.some((file) => file.name === 'brainstorm-record.json')) return { error: `${markerName} requires its canonical brainstorm-record.json` };
	}
	return {
		manifest: {
			schemaVersion: 1,
			files,
			...(candidate.brainstormGeneration === undefined ? {} : { brainstormGeneration: candidate.brainstormGeneration }),
			...(candidate.planningGeneration === undefined ? {} : { planningGeneration: candidate.planningGeneration }),
		},
	};
};
