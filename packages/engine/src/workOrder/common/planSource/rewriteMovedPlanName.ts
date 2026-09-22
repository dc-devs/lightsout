import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';

interface Params {
	/** The new plan's own folder, which the moved records now sit in. */
	planFolder: string;
	/** The plan's address, which is the name those records must carry from now on. */
	address: string;
}

/** The two records that name the plan they were written for; neither is required, and a folder may hold either alone. */
const movedRecordNames = ['decisions.json', 'brainstorm-decisions.json'];

/** One record pointed at the plan it is now part of, or the sentence saying why it could not be. */
const rewriteRecord = async ({ path, address }: { path: string; address: string }) => {
	let sentence: string | undefined;

	try {
		const fields: Record<string, unknown> = JSON.parse(await readFile(path, 'utf8'));

		// Neither record is strict, so every other field and the key order are kept
		// as they were found and only this one name is replaced.
		await writeFile(path, `${JSON.stringify({ ...fields, planName: address }, undefined, '\t')}\n`, 'utf8');
	} catch (error) {
		sentence = `${path} still names the folder its files came from rather than ${address}, and has to be pointed at the plan by hand: ${messageOf({ error })}`;
	}

	return sentence;
};

/**
 * Point the moved records at the plan they are now part of, or say which one
 * could not be.
 *
 * This is the rename a human used to have to finish by hand: a folder is moved
 * and `decisions.json` — with `brainstorm-decisions.json` beside it when a
 * brainstorm shaped the plan — goes on naming the folder it was written in,
 * while nothing in the engine compares the two. Which records are there is read
 * from the folder rather than from a failed open, so a record that simply is not
 * there has nothing said about it; one that is there and could not be read,
 * parsed or written is reported, because the plan itself already stands by then.
 */
export const rewriteMovedPlanName = async ({ planFolder, address }: Params): Promise<string | undefined> => {
	const present: string[] = await readdir(planFolder).catch(() => []);
	const sentences: string[] = [];

	for (const name of movedRecordNames.filter((record) => present.includes(record))) {
		const sentence = await rewriteRecord({ path: join(planFolder, name), address });

		if (sentence !== undefined) {
			sentences.push(sentence);
		}
	}

	return sentences.length === 0 ? undefined : sentences.join(' ');
};
