import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	/** The primary checkout the record is written under. */
	cwd: string;
	/** The work order's label — its folder under the work-orders directory. */
	name: string;
	/** The branch its plans implement on. Defaults to the label, as the default template renders it. */
	branch?: string;
	/** The ticket it belongs to, as the tracker names it. */
	ticketRef?: string;
	/**
	 * The record's mode. Single-plan by default, which is the mode that gates
	 * nothing: a fixture whose whole job is to make a work order claim a branch
	 * must not also decide whether that branch may ship.
	 */
	mode?: 'single-plan' | 'multiple-plan';
	/**
	 * The plans the record holds. Defaults to one implemented plan 001, which is
	 * what a branch standing ready to ship actually carries — a record holding
	 * none is a branch its own record refuses to ship.
	 */
	plans?: { id: string; title: string; progress: string; createdAt: string }[];
	/** The human's approval to ship, when a case ships a multiple-plan work order. */
	shipRequest?: { planIds: string[]; requestedAt: string };
}

/**
 * One work order's record on disk, written by hand.
 *
 * Every reader of a branch — the branch phase, the ship result, the worktree
 * ownership and the worktree path — starts from the record, so a drain test
 * that expects any of those to be filed needs the work order they belong to.
 */
export const seedWorkOrderRecord = ({
	cwd,
	name,
	branch = name,
	ticketRef,
	mode = 'single-plan',
	plans = [{ id: '001-seeded', title: 'Seeded plan', progress: 'implemented', createdAt: '2026-01-01T00:00:00.000Z' }],
	shipRequest,
}: Params): void => {
	const folder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'state.json'),
		JSON.stringify({
			schemaVersion: 1,
			name,
			branch,
			...(ticketRef === undefined ? {} : { ticketRef }),
			mode,
			plans,
			...(shipRequest === undefined ? {} : { shipRequest }),
			history: [],
		}),
		'utf8',
	);
};
