import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import {
	isDurablePlanAttachmentName,
	type PlanAttachmentManifest,
	parsePlanAttachmentManifest,
	planAttachmentManifestName,
	planAttachmentSha256,
} from '#src/plan/common/planAttachmentManifest.ts';
import { validatePlanAttachmentGeneration } from '#src/plan/common/validatePlanAttachmentGeneration.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { getTicketAttachments, readTicketAsset, type TrackerAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** The ticket reference that folder's name carries, e.g. 'lo-54'. */
	identifier: string;
	settings: TrackerSettings;
}

interface RestoredPlanWorkspace {
	/** Durable file names written into the folder, sorted. Empty when the ticket carries no plan. */
	restored: string[];
	/** Set when the ticket could not supply one complete, verified generation or it could not be written. */
	error?: string;
}

interface GenerationFile {
	title: string;
	url: string;
	sha256: string;
}

interface ReadGenerationFile {
	title: string;
	text: string;
}

/** Read one attachment while retaining its title in every refusal. */
const readAttachment = async ({ settings, attachment }: { settings: TrackerSettings; attachment: TrackerAttachment }) => {
	const text = await readTicketAsset({ settings, url: attachment.url });

	return typeof text === 'string' ? { text } : { error: `the ticket's ${attachment.title} could not be read: ${text.error}` };
};

/**
 * Resolve the manifest's exact generation. Unlisted durable attachments are
 * stale by definition and harmless; a missing or duplicate listed title is not.
 */
const selectGeneration = ({
	manifest,
	durableAttachments,
}: {
	manifest: PlanAttachmentManifest;
	durableAttachments: TrackerAttachment[];
}): { files: GenerationFile[] } | { error: string } => {
	const files: GenerationFile[] = [];

	for (const listed of manifest.files) {
		const matches = durableAttachments.filter(({ title }) => title === listed.name);

		if (matches.length === 0) {
			return { error: `${planAttachmentManifestName} lists ${listed.name}, but the ticket carries no attachment with that title` };
		}

		if (matches.length > 1) {
			return { error: `the ticket carries more than one attachment named ${listed.name}, so ${planAttachmentManifestName} cannot select one generation` };
		}

		const attachment = matches[0];

		if (attachment === undefined) {
			return { error: `${planAttachmentManifestName} lists ${listed.name}, but the ticket carries no attachment with that title` };
		}

		files.push({ title: attachment.title, url: attachment.url, sha256: listed.sha256 });
	}

	return { files };
};

/** Every selected attachment's verified text, or the first contextual read/hash refusal. */
const readAndVerifyGeneration = async ({ settings, files }: { settings: TrackerSettings; files: GenerationFile[] }) => {
	const reads = await Promise.all(
		files.map(async (file) => ({
			file,
			read: await readAttachment({ settings, attachment: { id: '', title: file.title, url: file.url } }),
		})),
	);
	const verified: ReadGenerationFile[] = [];

	for (const { file, read } of reads) {
		if ('error' in read) {
			return { error: read.error };
		}

		const actual = planAttachmentSha256({ content: read.text });

		if (actual !== file.sha256) {
			return { error: `${file.title} does not match the SHA-256 committed by ${planAttachmentManifestName} — publish the plan again` };
		}

		verified.push({ title: file.title, text: read.text });
	}

	return { files: verified };
};

/** Write the complete restored set off to the side, then expose it with one rename. */
const writeAll = async ({ dir, files }: { dir: string; files: ReadGenerationFile[] }) => {
	let temporaryDir: string | undefined;

	try {
		const parent = dirname(dir);

		await mkdir(parent, { recursive: true });
		temporaryDir = await mkdtemp(join(parent, '.restore-'));

		// The set is small, and sequential writes guarantee no sibling write is
		// still touching the temporary directory if one fails and cleanup begins.
		for (const { title, text } of files) {
			await writeFile(join(temporaryDir, title), text, 'utf8');
		}

		await rename(temporaryDir, dir);

		return undefined;
	} catch (error) {
		if (temporaryDir !== undefined) {
			// Cleanup is best-effort and must never hide the primary setup/write error.
			await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
		}

		return { error: `the restored plan could not be written: ${messageOf({ error })}` };
	}
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
export const restorePlanWorkspace = async ({ cwd, name, identifier, settings }: Params): Promise<RestoredPlanWorkspace> => {
	const attachments = await getTicketAttachments({ settings, identifier });

	if ('error' in attachments) {
		return { restored: [], error: attachments.error };
	}

	const durableAttachments = attachments.filter(({ title }) => isDurablePlanAttachmentName({ name: title }));
	const manifests = attachments.filter(({ title }) => title === planAttachmentManifestName);

	if (durableAttachments.length === 0 && manifests.length === 0) {
		return { restored: [] };
	}

	if (manifests.length === 0) {
		return {
			restored: [],
			error: `the ticket carries durable plan attachments but no ${planAttachmentManifestName} commit marker — publish the plan again before implementing it`,
		};
	}

	if (manifests.length > 1) {
		return {
			restored: [],
			error: `the ticket carries more than one ${planAttachmentManifestName} attachment, so no single committed plan generation can be selected`,
		};
	}

	const manifestAttachment = manifests[0];

	if (manifestAttachment === undefined) {
		return { restored: [], error: `the ticket carries no ${planAttachmentManifestName} commit marker` };
	}

	const manifestRead = await readAttachment({ settings, attachment: manifestAttachment });

	if ('error' in manifestRead) {
		return { restored: [], error: manifestRead.error };
	}

	const parsed = parsePlanAttachmentManifest({ text: manifestRead.text });

	if ('error' in parsed) {
		return { restored: [], error: parsed.error };
	}

	const selected = selectGeneration({ manifest: parsed.manifest, durableAttachments });

	if ('error' in selected) {
		return { restored: [], error: selected.error };
	}

	const read = await readAndVerifyGeneration({ settings, files: selected.files });

	if ('error' in read) {
		return { restored: [], error: read.error };
	}

	const refusal = validatePlanAttachmentGeneration({ files: read.files.map(({ title, text }) => ({ name: title, text })) });

	if (refusal !== undefined) {
		return { restored: [], error: refusal.error };
	}

	const written = await writeAll({ dir: planWorkspaceDir({ cwd, name }), files: read.files });

	if (written !== undefined) {
		return { restored: [], error: written.error };
	}

	return { restored: read.files.map(({ title }) => title).sort() };
};
