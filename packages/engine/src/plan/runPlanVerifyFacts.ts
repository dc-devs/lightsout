import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthoredFacts, type PlanFacts } from '@lightsout/contracts';
import { planWorkspaceDir } from './planWorkspaceDir';
import { readPlanWorkspaceFile } from './common/utils/readPlanWorkspaceFile';
import { verifyFacts } from './verifyFacts';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
	onProgress?: (message: string) => void;
}

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
export const runPlanVerifyFacts = async ({ cwd, name, onProgress }: Params): Promise<RunPlanVerifyFactsResult> => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });
	const factsPath = join(workspaceDir, 'facts.json');

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
		return { status: 'failed' as const, workspaceDir, error: error instanceof Error ? error.message : String(error) };
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
