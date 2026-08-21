import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
	/** Explorer areas for facts.json — shape is the caller's business, so scope cases can bend it. */
	areas?: unknown[];
	/** When present, written as brainstorm-decisions.json — the /brainstorm hand-off. */
	brainstormDecisions?: unknown;
}

/** Seed the plan workspace with the facts + decisions `plan draft` reads, plus an optional brainstorm hand-off. */
export const seedPlanWorkspace = ({ cwd, name, areas = [], brainstormDecisions }: Params): void => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'facts.json'),
		JSON.stringify({
			request: 'do a thing',
			areas,
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
	);
	writeFileSync(join(dir, 'decisions.json'), JSON.stringify({ planName: name, decisions: [] }));

	if (brainstormDecisions !== undefined) {
		writeFileSync(join(dir, 'brainstorm-decisions.json'), JSON.stringify(brainstormDecisions));
	}
};
