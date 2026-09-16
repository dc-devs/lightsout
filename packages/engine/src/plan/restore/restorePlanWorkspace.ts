import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';
import { parseAttachmentManifest } from '#src/common/attachmentManifest/parseAttachmentManifest.ts';
import { readManifestAttachment } from '#src/common/attachmentManifest/readManifestAttachment.ts';
import { scopeAttachments } from '#src/common/attachmentManifest/scopeAttachments.ts';
import type { AttachmentManifest } from '#src/common/types/AttachmentManifest.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
import { isDurablePlanAttachmentName } from '#src/plan/common/utils/isDurablePlanAttachmentName.ts';
import { isPlanOnlyAttachmentName } from '#src/plan/common/utils/isPlanOnlyAttachmentName.ts';
import { validatePlanAttachmentGeneration } from '#src/plan/common/validatePlanAttachmentGeneration.ts';
import type { ReadGenerationFile } from '#src/plan/restore/common/types/ReadGenerationFile.ts';
import { restoreVerifiedFiles } from '#src/plan/restore/common/utils/restoreVerifiedFiles.ts';
import { getTicketAttachments, type TrackerAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** The ticket reference that folder's name carries, e.g. 'lo-54'. */
	identifier: string;
	settings: TrackerSettings;
	/** The plan id the ticket's titles for this plan are namespaced under; absent for a legacy folder. */
	titlePrefix?: string;
	expectedMarker?: string;
	/** Validate and stage related required files before the plan directory becomes visible. */
	beforeExpose?: (params: { directory: string }) => Promise<void>;
}

interface RestoredPlanWorkspace {
	/** Durable file names written into the folder, sorted. Empty when the ticket carries no plan. */
	restored: string[];
	/** Set when the ticket could not supply one complete, verified generation or it could not be written. */
	error?: string;
	/** SHA-256 of the marker text this generation was selected by, set for a prefixed restore that wrote a folder. */
	markerSha256?: string;
}

interface GenerationFile {
	title: string;
	url: string;
	sha256: string;
}

/** Read one attachment while retaining its title in every refusal. */

/**
 * Resolve the manifest's exact generation. Unlisted durable attachments are
 * stale by definition and harmless; a missing or duplicate listed title is not.
 */
const selectGeneration = ({
	manifest,
	durableAttachments,
	markerName,
}: {
	manifest: AttachmentManifest;
	durableAttachments: TrackerAttachment[];
	markerName: string;
}): { files: GenerationFile[] } | { error: string } => {
	const files: GenerationFile[] = [];

	for (const listed of manifest.files) {
		const matches = durableAttachments.filter(({ title }) => title === listed.name);
		const attachment = matches.length === 1 ? matches[0] : undefined;

		if (attachment === undefined) {
			return {
				error:
					matches.length === 0
						? `${markerName} lists ${listed.name}, but the ticket carries no attachment with that title`
						: `the ticket carries more than one attachment named ${listed.name}, so ${markerName} cannot select one generation`,
			};
		}

		files.push({ title: attachment.title, url: attachment.url, sha256: listed.sha256 });
	}

	return { files };
};

/**
 * The one commit marker this restore selects a generation by.
 *
 * Three outcomes, and the difference between them matters: exactly one marker
 * is a generation to restore, no marker with no plan attachments at all is a
 * ticket that has never carried a plan, and anything else is a ticket whose
 * plan cannot be read without republishing it.
 */
const selectManifestAttachment = ({
	attachments,
	planOnlyAttachments,
	markerName,
}: {
	attachments: TrackerAttachment[];
	planOnlyAttachments: TrackerAttachment[];
	markerName: string;
}): { manifest: TrackerAttachment | undefined } | { error: string } => {
	const manifests = attachments.filter(({ title }) => title === planAttachmentManifestName);
	const manifest = manifests.length === 1 ? manifests[0] : undefined;

	if (manifest !== undefined) {
		return { manifest };
	}

	if (manifests.length > 1) {
		return { error: `the ticket carries more than one ${markerName} attachment, so no single committed plan generation can be selected` };
	}

	return planOnlyAttachments.length === 0
		? { manifest: undefined }
		: { error: `the ticket carries durable plan attachments but no ${markerName} commit marker — publish the plan again before implementing it` };
};

/** Every selected attachment's verified text, or the first contextual read/hash refusal. */
const readAndVerifyGeneration = async ({ settings, files, markerName }: { settings: TrackerSettings; files: GenerationFile[]; markerName: string }) => {
	const reads = await Promise.all(
		files.map(async (file) => ({
			file,
			read: await readManifestAttachment({ settings, attachment: { id: '', title: file.title, url: file.url } }),
		})),
	);
	const verified: ReadGenerationFile[] = [];

	for (const { file, read } of reads) {
		if ('error' in read) {
			return { error: read.error };
		}

		const actual = sha256({ content: read.text });

		if (actual !== file.sha256) {
			return { error: `${file.title} does not match the SHA-256 committed by ${markerName} — publish the plan again` };
		}

		verified.push({ title: file.title, text: read.text });
	}

	return { files: verified };
};

const selectNamespace = ({ listed, titlePrefix }: { listed: TrackerAttachment[]; titlePrefix?: string }) => {
	const attachments = scopeAttachments({ attachments: listed, prefix: titlePrefix });
	const markerName = attachmentTitle({ prefix: titlePrefix, name: planAttachmentManifestName });
	// Under a prefix the brainstorm generation owns `brainstorm-notes.md`, so a
	// plan generation may neither carry it nor commit it; a legacy marker still
	// may, which is why the selectable set stays the wider one there.
	const isSelectableName = titlePrefix === undefined ? isDurablePlanAttachmentName : isPlanOnlyAttachmentName;
	const durableAttachments = attachments.filter(({ title }) => isSelectableName({ name: title }));
	// Two different questions, deliberately asked with two predicates. Which
	// attachments this generation may select stays the durable set, so a plan
	// marker listing `brainstorm-notes.md` still restores it. Whether a plan was
	// published at all excludes that shared title, because `brainstorm publish`
	// sends it too — a ticket carrying only a brainstorm is a ticket with no
	// plan, not an interrupted plan upload.
	const planOnlyAttachments = attachments.filter(({ title }) => isPlanOnlyAttachmentName({ name: title }));
	return { attachments, markerName, isSelectableName, durableAttachments, planOnlyAttachments };
};
/**
 * Rebuild a plan folder from the one ticket generation committed by
 * `plan-attachments.json`. The manifest is transport metadata and is never
 * written into the workspace; run state is neither listed nor restored.
 *
 * Every refusal path creates no plan folder. A later successful publish can
 * therefore be fetched instead of an incomplete folder permanently winning the
 * disk-first check.
 */
export const restorePlanWorkspace = async ({
	cwd,
	name,
	identifier,
	settings,
	titlePrefix,
	expectedMarker,
	beforeExpose,
}: Params): Promise<RestoredPlanWorkspace> => {
	const listed = await getTicketAttachments({ settings, identifier });

	if ('error' in listed) {
		return { restored: [], error: listed.error };
	}

	// Everything below is written against bare file names, so one plan's
	// namespace is turned back into the single-plan list those steps already
	// read before any of them runs.
	const { attachments, markerName, isSelectableName, durableAttachments, planOnlyAttachments } = selectNamespace({ listed, titlePrefix });
	const selected = selectManifestAttachment({ attachments, planOnlyAttachments, markerName });

	if ('error' in selected) {
		return { restored: [], error: selected.error };
	}

	if (selected.manifest === undefined) {
		return { restored: [], ...(expectedMarker ? { error: 'The ticket record requires a published plan generation, but its marker is missing' } : {}) };
	}

	const manifestRead = await readManifestAttachment({ settings, attachment: selected.manifest });

	if ('error' in manifestRead) {
		return { restored: [], error: manifestRead.error };
	}

	if (expectedMarker !== undefined && sha256({ content: manifestRead.text }) !== expectedMarker)
		return { restored: [], error: 'Published plan marker differs from the selected ticket record' };

	const parsed = parseAttachmentManifest({ text: manifestRead.text, markerName, isAllowedName: isSelectableName });

	if ('error' in parsed) {
		return { restored: [], error: parsed.error };
	}

	const generation = selectGeneration({ manifest: parsed.manifest, durableAttachments, markerName });

	if ('error' in generation) {
		return { restored: [], error: generation.error };
	}

	const read = await readAndVerifyGeneration({ settings, files: generation.files, markerName });

	if ('error' in read) {
		return { restored: [], error: read.error };
	}

	const refusal = validatePlanAttachmentGeneration({ files: read.files.map(({ title, text }) => ({ name: title, text })) });

	if (refusal !== undefined) {
		return { restored: [], error: refusal.error };
	}

	const written = await restoreVerifiedFiles({ cwd, name, files: read.files, manifest: parsed.manifest, marker: manifestRead.text, beforeExpose });
	if (written !== undefined) {
		return { restored: [], error: written.error };
	}

	const restored = read.files.map(({ title }) => title).sort();

	return titlePrefix === undefined ? { restored } : { restored, markerSha256: sha256({ content: manifestRead.text }) };
};
