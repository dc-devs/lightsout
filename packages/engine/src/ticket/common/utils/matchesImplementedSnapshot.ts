import { readFile } from 'node:fs/promises';
import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { durablePlanFiles } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	/** The plan's address, `<ticket-branch>/<plan-id>`. */
	address: string;
	/** The plan's durable files as the passed implementation run left them. */
	snapshot: { name: string; sha256: string }[];
}

/**
 * Whether a plan's folder still holds exactly the files its passed
 * implementation recorded, byte for byte.
 *
 * An implemented plan is the scope the ticket ships on, so republishing it is
 * allowed only while its files have not changed. Both directions are asked: a
 * snapshot entry whose file is gone or edited, and a file the prefixed
 * generation would now attach that the snapshot never named. The second
 * question skips `brainstorm-notes.md`, which the brainstorm generation owns —
 * that is what makes this answer the same whether or not the run's snapshot
 * listed the notes.
 */
export const matchesImplementedSnapshot = async ({ cwd, address, snapshot }: Params): Promise<boolean> => {
	const durable = await durablePlanFiles({ cwd, name: address });
	const named = new Set(snapshot.map(({ name }) => name));
	const attachable = durable.files.filter(({ name }) => name !== brainstormNotesFileName);
	let matches = durable.error === undefined && attachable.every(({ name }) => named.has(name));

	for (const entry of snapshot) {
		const file = matches ? durable.files.find(({ name }) => name === entry.name) : undefined;
		const content = file === undefined ? undefined : await readFile(file.path).catch(() => undefined);

		matches = matches && content !== undefined && sha256({ content }) === entry.sha256;
	}

	return matches;
};
