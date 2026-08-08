import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@/plan/common/paths/pathExists';
import { planWorkspaceDir } from '@/plan/planWorkspaceDir';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
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
 * Resolve a plan deliverable to its files, reading the plan's own workspace
 * folder: `plan.md` is the sole deliverable of a single plan; otherwise
 * `overview.md` is context and every `phase<N>-<slug>.md` is a deliverable.
 * Files are matched by name, not by extension, because the folder also holds the
 * plan's working files (`notes.md`, the JSON records) — none of which is a plan
 * to grade. Shared by the dedup and grade passes, which resolve the deliverable
 * identically.
 */
export const resolvePlanDeliverable = async ({ cwd, name }: Params): Promise<ResolvedDeliverable> => {
	const dir = planWorkspaceDir({ cwd, name });
	const singlePath = join(dir, 'plan.md');

	let overviewPath: string | undefined;
	let overviewText: string | undefined;
	const files: DeliverableFile[] = [];

	if (await pathExists({ path: singlePath })) {
		files.push({ path: singlePath, text: await readFile(singlePath, 'utf8') });
	} else {
		const entries = (await readdir(dir).catch(() => [] as string[]))
			.filter((entry) => entry === 'overview.md' || /^phase\d+.*\.md$/.test(entry))
			.sort();

		for (const entry of entries) {
			const path = join(dir, entry);
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
		return { files, error: `no plan found for '${name}' — expected ${singlePath} or ${dir}/phase<N>-<slug>.md` };
	}

	return { overviewPath, overviewText, files };
};
