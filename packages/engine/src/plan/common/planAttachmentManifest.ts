import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';

/** The ticket attachment committed last, after every file whose bytes it names. */
export const planAttachmentManifestName = 'plan-attachments.json';

export interface PlanAttachmentManifestFile {
	name: string;
	sha256: string;
}

export interface PlanAttachmentManifest {
	schemaVersion: 1;
	files: PlanAttachmentManifestFile[];
}

/** Attachment titles are untrusted; only bare durable plan file names may enter a transport generation. */
export const isDurablePlanAttachmentName = ({ name }: { name: string }) =>
	name === basename(name) &&
	name !== '.' &&
	name !== '..' &&
	!/[\\/]/.test(name) &&
	(durablePlanFileNames.records.includes(name) || durablePlanFileNames.deliverable.test(name));

/** Hash the exact bytes publish sends and restore receives. */
export const planAttachmentSha256 = ({ content }: { content: Buffer | string }) => createHash('sha256').update(content).digest('hex');

/** Build the commit marker for one fully read generation. */
export const serializePlanAttachmentManifest = ({ files }: { files: { name: string; content: Buffer }[] }) =>
	Buffer.from(
		`${JSON.stringify(
			{
				schemaVersion: 1,
				files: files.map(({ name, content }) => ({ name, sha256: planAttachmentSha256({ content }) })),
			} satisfies PlanAttachmentManifest,
			null,
			2,
		)}\n`,
		'utf8',
	);

/** Parse and validate the untrusted commit marker before any listed asset is selected. */
export const parsePlanAttachmentManifest = ({ text }: { text: string }): { manifest: PlanAttachmentManifest } | { error: string } => {
	let value: unknown;

	try {
		value = JSON.parse(text);
	} catch (error) {
		return { error: `${planAttachmentManifestName} is not valid JSON: ${messageOf({ error })}` };
	}

	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { error: `${planAttachmentManifestName} must contain an object` };
	}

	const candidate = value as { schemaVersion?: unknown; files?: unknown };

	if (candidate.schemaVersion !== 1) {
		return { error: `${planAttachmentManifestName} has unsupported schemaVersion ${JSON.stringify(candidate.schemaVersion)} — expected 1` };
	}

	if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
		return { error: `${planAttachmentManifestName} must list at least one durable plan file` };
	}

	const files: PlanAttachmentManifestFile[] = [];

	for (const entry of candidate.files) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			return { error: `${planAttachmentManifestName} contains a file entry that is not an object` };
		}

		const file = entry as { name?: unknown; sha256?: unknown };

		if (typeof file.name !== 'string' || !isDurablePlanAttachmentName({ name: file.name })) {
			return { error: `${planAttachmentManifestName} contains a non-durable or unsafe file name: ${JSON.stringify(file.name)}` };
		}

		if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
			return { error: `${planAttachmentManifestName} contains an invalid SHA-256 for ${file.name}` };
		}

		if (files.some(({ name }) => name === file.name)) {
			return { error: `${planAttachmentManifestName} lists ${file.name} more than once` };
		}

		files.push({ name: file.name, sha256: file.sha256 });
	}

	return { manifest: { schemaVersion: 1, files } };
};
