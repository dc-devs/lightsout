import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AuthoredFacts, type PlanFacts } from '@/contracts';
import { planWorkspaceDir } from '@/plan/planWorkspaceDir';
import { readPlanWorkspaceFile } from '@/plan/common/utils/readPlanWorkspaceFile';
import { verifyFacts } from '@/plan/verifyFacts';
import { messageOf } from '@/common/utils/messageOf';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
	/** Cwd-relative or absolute path to a rough-notes file to freeze into the workspace (write-once). */
	notesFile?: string;
	onProgress?: (message: string) => void;
}

/** Freeze a copy of the rough-notes file at `<workspaceDir>/notes.md` — write-once, an existing snapshot is never overwritten. */
const snapshotNotes = async ({
	cwd,
	workspaceDir,
	notesFile,
	progress,
}: {
	cwd: string;
	workspaceDir: string;
	notesFile: string;
	progress: (message: string) => void;
}) => {
	const source = resolve(cwd, notesFile);
	const destination = join(workspaceDir, 'notes.md');

	const alreadyFrozen = await access(destination).then(
		() => true,
		() => false,
	);

	if (alreadyFrozen) {
		progress('plan verify-facts · notes.md already frozen — snapshot skipped');

		return { error: undefined };
	}

	try {
		await mkdir(workspaceDir, { recursive: true });
		await copyFile(source, destination);
	} catch {
		return { error: `notes file not found: ${source}` };
	}

	progress(`plan verify-facts · notes frozen → ${destination}`);

	return { error: undefined };
};

type RunPlanVerifyFactsResult =
	| { status: 'complete'; facts: PlanFacts; factsPath: string; workspaceDir: string; error: undefined }
	| { status: 'failed'; workspaceDir: string; error: string };

/**
 * Deterministically verify session-authored plan facts and stamp the canonical
 * `facts.json` — no agent. The conducting session explores in-context and
 * authors `{ request, areas }`; this parses it (parse-don't-cast), re-checks
 * every claimed path/script on disk via `verifyFacts`, and rewrites the file
 * as a full `PlanFacts` with `verification` + `verifiedAt`. Missing paths are
 * data for the session (Elicitation input), never a failure; only an
 * unreadable or unparsable authored file fails. Idempotent — re-running
 * re-verifies and re-stamps.
 */
export const runPlanVerifyFacts = async ({ cwd, name, notesFile, onProgress }: Params): Promise<RunPlanVerifyFactsResult> => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });
	const factsPath = join(workspaceDir, 'facts.json');

	// The snapshot runs before the facts read: the notes freeze even when the
	// authored facts are missing or unparsable — notes.md is the plan's first artifact.
	if (notesFile !== undefined) {
		const snapshot = await snapshotNotes({ cwd, workspaceDir, notesFile, progress });

		if (snapshot.error !== undefined) {
			return { status: 'failed' as const, workspaceDir, error: snapshot.error };
		}
	}

	let authored: AuthoredFacts;

	try {
		authored = await readPlanWorkspaceFile({
			cwd,
			name,
			fileName: 'facts.json',
			schema: AuthoredFacts,
			notFound: (filePath) => `no authored facts for plan ${name} at ${filePath} — author facts.json ({ request, areas }), then re-run: lightsout plan verify-facts --name ${name}`,
		});
	} catch (error) {
		return { status: 'failed' as const, workspaceDir, error: messageOf({ error }) };
	}

	const verification = await verifyFacts({ cwd, facts: authored });
	const facts: PlanFacts = {
		request: authored.request,
		areas: authored.areas,
		verification,
		verifiedAt: new Date().toISOString(),
	};

	await writeFile(factsPath, `${JSON.stringify(facts, undefined, '\t')}\n`, 'utf8');

	const missingPart = verification.missingPaths.length > 0 ? `, ${verification.missingPaths.length} missing: ${verification.missingPaths.join(', ')}` : '';

	progress(
		`plan verify-facts · ${verification.pathsChecked} path(s) verified${missingPart}; ${verification.scriptsChecked} script(s) checked, ${verification.missingScripts.length} missing`,
	);

	return { status: 'complete' as const, facts, factsPath, workspaceDir, error: undefined };
};
