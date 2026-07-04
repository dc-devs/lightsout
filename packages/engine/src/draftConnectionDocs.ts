import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { TraceState } from '@lightsout/contracts';

const slugOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'edge';

interface Params {
	cwd: string;
	connectionsDir: string;
	/** The traverse run whose GAPs to scaffold. */
	traverseRunId: string;
}

/**
 * Every traversal should improve the map: each GAP that carried a concrete
 * exit becomes a draft scaffold under `drafts/` — the from-side is real
 * (the hop agent cited it); the to-side is what the human fills in. Drafts
 * live in a subdirectory precisely so the map reader never routes through
 * an unfinished edge; completing one = fixing `to`, verifying anchors, and
 * moving the file up a level.
 */
export const draftConnectionDocs = async ({ cwd, connectionsDir, traverseRunId }: Params) => {
	const mapDir = isAbsolute(connectionsDir) ? connectionsDir : join(cwd, connectionsDir);
	const tracePath = join(cwd, '.lightsout', 'traverse', traverseRunId, 'trace.json');
	const raw = await readFile(tracePath, 'utf8').catch(() => {
		throw new Error(`no trace found for run ${traverseRunId} at ${tracePath}`);
	});
	const state = TraceState.parse(JSON.parse(raw));
	const draftsDir = join(mapDir, 'drafts');
	const drafted: string[] = [];

	await mkdir(draftsDir, { recursive: true });

	for (const gap of state.gaps) {
		if (!gap.exit) {
			continue;
		}

		const id = `${gap.node}--UNKNOWN--${slugOf(gap.exit.target)}`;
		const content = [
			'---',
			`from: ${gap.node}`,
			'to: UNKNOWN # <- fill in the receiving node, then move this file up into the connections dir',
			`type: ${gap.exit.kind}`,
			'from-anchor:',
			`  path: ${gap.exit.at.split(':')[0]}`,
			`  pattern: "${gap.exit.target.replace(/"/g, '\\"')}" # <- replace with the greppable code fragment at the emit site`,
			'additional-context: []',
			'---',
			'',
			'# Summary',
			'',
			`DRAFT from traverse run ${traverseRunId}: ${gap.node} emits ${gap.exit.kind} → ${gap.exit.target} at ${gap.exit.at}, carrying ${gap.exit.carries}. Receiver unknown — ${gap.detail}`,
		].join('\n');

		await writeFile(join(draftsDir, `${id}.md`), `${content}\n`, 'utf8');
		drafted.push(id);
	}

	return { drafted, draftsDir };
};
