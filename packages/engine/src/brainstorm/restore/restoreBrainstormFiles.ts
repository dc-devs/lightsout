import { brainstormAttachmentFileNames } from '#src/brainstorm/common/constants/brainstormAttachmentFileNames.ts';
import { brainstormAttachmentManifestName } from '#src/brainstorm/common/constants/brainstormAttachmentManifestName.ts';
import { isBrainstormOnlyAttachmentName } from '#src/brainstorm/common/utils/isBrainstormOnlyAttachmentName.ts';
import { writeBrainstormFiles } from '#src/brainstorm/restore/common/utils/writeBrainstormFiles.ts';
import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';
import { parseAttachmentManifest } from '#src/common/attachmentManifest/parseAttachmentManifest.ts';
import { readManifestAttachment } from '#src/common/attachmentManifest/readManifestAttachment.ts';
import { scopeAttachments } from '#src/common/attachmentManifest/scopeAttachments.ts';
import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';
import type { AttachmentManifest } from '#src/common/types/AttachmentManifest.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { planWorkspaceDir, restoreBrainstormGeneration, validateBrainstormRestoreBinding } from '#src/plan/index.ts';
import { getTicketAttachments, type TrackerAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the brainstorm's files are written into. */
	name: string;
	/** The ticket reference that folder's name carries, e.g. 'lo-117'. */
	identifier: string;
	settings: TrackerSettings;
	/** The plan id the ticket's titles for this plan are namespaced under; absent for a legacy folder. */
	titlePrefix?: string;
	/** Optional private plan staging directory, supplied before atomic publication of a combined restore. */
	directory?: string;
}

interface RestoredBrainstormFiles {
	/** File names written into the folder, sorted. Empty when the ticket carries no brainstorm. */
	restored: string[];
	/** Names the ticket carried that were already on disk and were left untouched, sorted. */
	skipped: string[];
	/** Set when the ticket could not supply one complete, verified generation, or it could not be written. */
	error?: string;
}

interface ReadGenerationFile {
	title: string;
	text: string;
}

/**
 * Read one attachment while retaining its title in every refusal.
 *
 * The result is annotated rather than inferred: without it the two branches
 * widen into one shape carrying an optional `error`, and `'error' in read`
 * stops narrowing at the call site.
 */

/** Resolve the marker's exact generation, then read and hash-verify every asset it names. */
const readGeneration = async ({
	settings,
	manifest,
	selected,
	markerName,
	required,
}: {
	settings: TrackerSettings;
	manifest: AttachmentManifest;
	selected: TrackerAttachment[];
	markerName: string;
	/** Which of this generation's names the marker must have committed. */
	required: string[];
}): Promise<{ files: ReadGenerationFile[] } | { error: string }> => {
	const files: ReadGenerationFile[] = [];

	for (const listed of manifest.files) {
		const matches = selected.filter(({ title }) => title === listed.name);
		const attachment = matches.length === 1 ? matches[0] : undefined;

		if (attachment === undefined) {
			return {
				error:
					matches.length === 0
						? `${markerName} lists ${listed.name}, but the ticket carries no attachment with that title`
						: `the ticket carries more than one attachment named ${listed.name}, so ${markerName} cannot select one generation`,
			};
		}

		const read = await readManifestAttachment({ settings, attachment });

		if ('error' in read) {
			return { error: read.error };
		}

		if (sha256({ content: read.text }) !== listed.sha256) {
			return { error: `${listed.name} does not match the SHA-256 committed by ${markerName} — publish the brainstorm again` };
		}

		files.push({ title: listed.name, text: read.text });
	}

	const missing = required.filter((name) => !files.some(({ title }) => title === name));

	return missing.length === 0
		? { files }
		: { error: `the brainstorm generation on the ticket is missing ${missing.join(', ')} — publish the brainstorm again from the machine holding the folder` };
};

/**
 * Write the verified files into the plan folder, never over one already there.
 *
 * Not the plan restore's write-to-temp-and-rename: that exposes a whole folder
 * with one rename and so requires the folder not to exist, and planning has
 * already authored `facts.json` here by the time this runs.
 */

const restoreGeneration = async ({
	cwd,
	name,
	directory,
	manifest,
	files,
	marker,
}: {
	cwd: string;
	name: string;
	directory?: string;
	manifest: AttachmentManifest;
	files: ReadGenerationFile[];
	marker: string;
}) => {
	if (manifest.brainstormGeneration !== undefined || files.some((file) => file.title === 'brainstorm-record.json')) {
		try {
			if (!manifest.brainstormGeneration) throw new Error('New-format brainstorm requires an explicit generation marker');
			return await restoreBrainstormGeneration({
				cwd,
				name,
				directory,
				files: new Map(files.map((file) => [file.title, file.text])),
				generation: manifest.brainstormGeneration,
				marker: marker,
			});
		} catch (error) {
			return { restored: [], skipped: [], error: messageOf({ error }) };
		}
	}
	try {
		await validateBrainstormRestoreBinding({ cwd, name, directory });
	} catch (error) {
		return { restored: [], skipped: [], error: messageOf({ error }) };
	}
	return writeBrainstormFiles({ dir: directory ?? planWorkspaceDir({ cwd, name }), files: files });
};

/**
 * Rebuild a brainstorm's files from the one ticket generation committed by
 * `brainstorm-attachments.json` — the ticket's own, or, under a plan id prefix,
 * that plan's.
 *
 * "Did a brainstorm publish to this ticket?" is asked with
 * `isBrainstormOnlyAttachmentName` for a legacy folder, never with the selected
 * set: the selected set includes `brainstorm-notes.md`, which a published
 * legacy *plan* carries too, so asking with it would refuse on every
 * plan-carrying ticket. Under a prefix the plan generation no longer carries the
 * notes, so that exclusion would only hide a notes-only generation — there, any
 * of the generation's own names counts. A ticket with no published brainstorm is
 * the ordinary case and is not a failure.
 */
export const restoreBrainstormFiles = async ({ cwd, name, identifier, settings, titlePrefix, directory }: Params): Promise<RestoredBrainstormFiles> => {
	const listed = await getTicketAttachments({ settings, identifier });

	if ('error' in listed) {
		return { restored: [], skipped: [], error: listed.error };
	}

	// One plan's namespace is turned back into the single-generation list every
	// step below already reads, before any of them runs.
	const attachments = scopeAttachments({ attachments: listed, prefix: titlePrefix });
	const markerName = attachmentTitle({ prefix: titlePrefix, name: brainstormAttachmentManifestName });
	const selected = attachments.filter(({ title }) => brainstormAttachmentFileNames.includes(title));
	const markers = attachments.filter(({ title }) => title === brainstormAttachmentManifestName);
	const marker = markers[0];
	// Under a prefix the plan generation never carries the notes, so any of this
	// generation's names is evidence a brainstorm was published for this plan. A
	// legacy ticket's two generations share `brainstorm-notes.md`, which is why
	// the wider question there still excludes it.
	const isEvidence =
		titlePrefix === undefined ? isBrainstormOnlyAttachmentName : ({ name: title }: { name: string }) => brainstormAttachmentFileNames.includes(title);

	if (!attachments.some(({ title }) => isEvidence({ name: title })) && markers.length === 0) {
		try {
			await validateBrainstormRestoreBinding({ cwd, name, directory });
		} catch (error) {
			return { restored: [], skipped: [], error: messageOf({ error }) };
		}
		return { restored: [], skipped: [] };
	}

	if (marker === undefined || markers.length > 1) {
		return {
			restored: [],
			skipped: [],
			error:
				marker === undefined
					? `the ticket carries brainstorm attachments but no ${markerName} commit marker — publish the brainstorm again`
					: `the ticket carries more than one ${markerName} attachment, so no single committed brainstorm generation can be selected`,
		};
	}

	const markerRead = await readManifestAttachment({ settings, attachment: marker });

	if ('error' in markerRead) {
		return { restored: [], skipped: [], error: markerRead.error };
	}

	const parsed = parseAttachmentManifest({
		text: markerRead.text,
		markerName,
		// The list holds two bare names, so membership is already the bareness
		// guard the plan side needs `basename` for.
		isAllowedName: ({ name: listed }) => brainstormAttachmentFileNames.includes(listed),
	});

	if ('error' in parsed) {
		return { restored: [], skipped: [], error: parsed.error };
	}

	const generation = await readGeneration({
		settings,
		manifest: parsed.manifest,
		selected,
		markerName,
		// Under a prefix `brainstorm-decisions.json` is optional, because a plan of
		// a ticket may be shaped by a brainstorm that settled no decision of its own.
		required: titlePrefix === undefined ? brainstormAttachmentFileNames.filter((name) => name !== 'brainstorm-record.json') : [brainstormNotesFileName],
	});

	if ('error' in generation) {
		return { restored: [], skipped: [], error: generation.error };
	}

	return restoreGeneration({ cwd, name, directory, manifest: parsed.manifest, files: generation.files, marker: markerRead.text });
};
