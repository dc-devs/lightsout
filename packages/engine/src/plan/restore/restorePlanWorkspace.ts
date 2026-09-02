import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';
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
	/** Set when the tracker could not be asked at all; `restored` is then empty. */
	error?: string;
}

/**
 * True when a title is a bare file name — no path separator, no `.` or `..`
 * segment. The traversal guard, kept apart from the naming rule below so
 * neither can be weakened by an edit to the other. The explicit separator test
 * covers a Windows-style title on a POSIX host, where `basename` alone answers
 * the whole string.
 */
const isBareFileName = ({ title }: { title: string }) => title === basename(title) && title !== '.' && title !== '..' && !/[\\/]/.test(title);

/** True when an attachment title names a durable plan file: a bare name that the durable-name list or its deliverable pattern accepts. */
const isDurablePlanFileName = ({ title }: { title: string }) =>
	isBareFileName({ title }) && (durablePlanFileNames.records.includes(title) || durablePlanFileNames.deliverable.test(title));

/** The deliverable-named titles that are neither of the two fixed names — a phased plan's phase files, spelled through the one naming rule rather than a second pattern. */
const phaseTitlesOf = ({ titles }: { titles: string[] }) =>
	titles.filter((title) => title !== 'plan.md' && title !== 'overview.md' && durablePlanFileNames.deliverable.test(title));

/**
 * The one sentence saying why a set of accepted titles is not a plan a run can
 * start from, or undefined when it is.
 *
 * `plan.md` sitting beside phase files is the case this exists for: it is what
 * a ticket carries after a plan was published single and re-published phased,
 * and `resolvePlanDeliverable` takes `plan.md` exclusively whenever it exists —
 * so restoring both would silently implement the superseded single plan.
 */
const runnableRefusal = ({ titles }: { titles: string[] }) => {
	const hasSingle = titles.includes('plan.md');
	const phases = phaseTitlesOf({ titles });
	const isRunnable = hasSingle ? phases.length === 0 : titles.includes('overview.md') && phases.length > 0;

	return isRunnable
		? undefined
		: `the ticket's plan attachments (${titles.join(', ')}) are not a plan a run can start from — expected plan.md on its own, or overview.md with at least one phase<N> file`;
};

/** Every accepted attachment's text, or the one sentence naming the first that could not be read. */
const readAll = async ({ settings, attachments }: { settings: TrackerSettings; attachments: TrackerAttachment[] }) => {
	const reads = await Promise.all(attachments.map(async ({ title, url }) => ({ title, text: await readTicketAsset({ settings, url }) })));
	const files: { title: string; text: string }[] = [];

	for (const { title, text } of reads) {
		if (typeof text !== 'string') {
			return { error: `the ticket's ${title} could not be read: ${text.error}` };
		}

		files.push({ title, text });
	}

	return { files };
};

/**
 * Rebuild a plan folder from its ticket's attachments.
 *
 * The plan module's side of the fetch: it knows what a durable plan file is
 * named, and reaches the tracker only through that module's barrel, so the API
 * key never enters plan code.
 *
 * Every refusal path creates no folder, deliberately. The caller fetches only
 * when the folder is absent, so writing an unrunnable folder would disable the
 * fetch for that plan for good — the next run would find it on disk,
 * short-circuit, and never ask the ticket again even after a correct publish.
 *
 * Run state never travels: only titles the durable-name predicate accepts are
 * read, and it admits no transcript, manifest or log.
 */
export const restorePlanWorkspace = async ({ cwd, name, identifier, settings }: Params): Promise<RestoredPlanWorkspace> => {
	const attachments = await getTicketAttachments({ settings, identifier });

	if ('error' in attachments) {
		return { restored: [], error: attachments.error };
	}

	const planFiles = attachments.filter(({ title }) => isDurablePlanFileName({ title }));

	if (planFiles.length === 0) {
		return { restored: [] };
	}

	const refusal = runnableRefusal({ titles: planFiles.map(({ title }) => title) });

	if (refusal !== undefined) {
		return { restored: [], error: refusal };
	}

	// Read first, write second: a plan restored with one phase missing is worse
	// than no plan, because the run would start and stop halfway.
	const read = await readAll({ settings, attachments: planFiles });

	if ('error' in read) {
		return { restored: [], error: read.error };
	}

	const dir = planWorkspaceDir({ cwd, name });

	await mkdir(dir, { recursive: true });

	for (const file of read.files) {
		await writeFile(join(dir, file.title), file.text, 'utf8');
	}

	return { restored: read.files.map(({ title }) => title).sort() };
};
