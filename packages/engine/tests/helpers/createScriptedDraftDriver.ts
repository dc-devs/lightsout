import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Driver } from '#src/drivers/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';

/** Which brief the invocation builder emitted — the only thing a real writer keys off too. */
export type DraftRole = 'single' | 'overview' | 'phase' | 'reshape' | 'repair';

/** A fixed-report answer a scripted spawn returns instead of authoring a body. */
type DraftAnswer = string | { text: string; exitCode: number; rateLimited?: boolean };

const briefRole = ({ prompt }: { prompt: string }): DraftRole => {
	if (prompt.includes('# Reshape input')) {
		return 'reshape';
	}

	if (prompt.includes('# Repair input')) {
		return 'repair';
	}

	if (prompt.includes('## Phase authoring')) {
		return 'phase';
	}

	return prompt.includes('## Overview only') ? 'overview' : 'single';
};

/** The plan-writer's drafted report for one authored file. */
const draftedReport = ({ path, role }: { path: string; role: DraftRole }) =>
	JSON.stringify({
		status: 'drafted',
		filesWritten: [{ path, variant: role === 'single' ? 'single' : role, scope: role }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});

/**
 * A stub harness answering every spawn shape the phased draft can emit. It reads
 * the role off the brief and the output path off the prompt, exactly as a real
 * writer would, and `respond` decides what that spawn does.
 *
 * `onCall` sees the prompt beside the role because what a downstream spawn is
 * handed is where an earlier step's edits to a plan file show up.
 */
export const createScriptedDraftDriver = ({
	respond,
	onCall,
}: {
	respond: (params: { role: DraftRole; path: string; file: string }) => DraftAnswer;
	onCall?: (params: { role: DraftRole; file: string; prompt: string }) => void;
}): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const role = briefRole({ prompt });
		const path = /- (\S+\.md)/.exec(prompt)?.[1];

		// every spawn is handed exactly the paths the engine chose
		expectDefined(path);
		onCall?.({ role, file: basename(path), prompt });

		const answer = respond({ role, path, file: basename(path) });

		if (typeof answer !== 'string') {
			return answer;
		}

		writeFileSync(path, answer);

		return role === 'reshape' || role === 'repair'
			? { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 }
			: { text: draftedReport({ path, role }), exitCode: 0 };
	},
});

/** A repair or reshape spawn that edits nothing — the finding set comes back identical, so the loop stops. */
export const unchangedFixReport = ({ path }: { path: string }): DraftAnswer => ({
	text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }),
	exitCode: 0,
});
