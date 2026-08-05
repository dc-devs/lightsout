import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@/plan/common/utils/pathExists';

interface Params {
	/** Kebab plan name — the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
}

/** A resolved deliverable file: its path and text. */
interface DeliverableFile {
	path: string;
	text: string;
}

interface ResolvedDeliverable {
	overviewPath?: string;
	overviewText?: string;
	/** The judged/graded files: the single plan, or every phase (overview excluded). */
	files: DeliverableFile[];
	/** Set when no plan file exists at either the single-file or the phased path. */
	error?: string;
}

/**
 * Resolve a plan deliverable to its files: a single `<plansDir>/<name>.md`, or
 * the phased `<plansDir>/<name>/` directory where `overview.md` is context and
 * every `phase<N>-<slug>.md` is a deliverable. Shared by the dedup and grade
 * passes, which resolve the deliverable identically.
 */
export const resolvePlanDeliverable = async ({ name, plansDir }: Params): Promise<ResolvedDeliverable> => {
	const singlePath = join(plansDir, `${name}.md`);
	const phaseDir = join(plansDir, name);

	let overviewPath: string | undefined;
	let overviewText: string | undefined;
	const files: DeliverableFile[] = [];

	if (await pathExists({ path: singlePath })) {
		files.push({ path: singlePath, text: await readFile(singlePath, 'utf8') });
	} else {
		const entries = (await readdir(phaseDir).catch(() => [] as string[])).filter((entry) => entry.endsWith('.md')).sort();

		for (const entry of entries) {
			const path = join(phaseDir, entry);
			const text = await readFile(path, 'utf8');

			if (entry === 'overview.md') {
				overviewPath = path;
				overviewText = text;
			} else {
				files.push({ path, text });
			}
		}
	}

	if (files.length === 0) {
		return { files, error: `no plan found for '${name}' — expected ${singlePath} or ${phaseDir}/phase<N>-<slug>.md` };
	}

	return { overviewPath, overviewText, files };
};
