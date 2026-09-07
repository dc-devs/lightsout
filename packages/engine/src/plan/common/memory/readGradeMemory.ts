import { readFile } from 'node:fs/promises';
import { GradeMemory } from '#src/contracts/index.ts';
import { gradeMemoryPath } from '#src/plan/common/memory/gradeMemoryPath.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/** The file's JSON, or the message saying why it is not JSON at all — the two halves the parse below tells apart. */
const readJson = async ({ path }: { path: string }): Promise<{ value: unknown } | { failure: string }> => {
	const text = await readFile(path, 'utf8');

	try {
		const value: unknown = JSON.parse(text);

		return { value };
	} catch (cause) {
		return { failure: cause instanceof Error ? cause.message : String(cause) };
	}
};

/**
 * Read the optional finding memory for a plan workspace. Absent file →
 * `undefined`: a plan graded for the first time has none, so absence is the
 * normal path and starts a fresh baseline.
 *
 * Present but unreadable → throws, naming the file. Grading on from a record the
 * engine could not read would either re-open every question a human already
 * settled or, worse, discard the ones still open and report the plan clean —
 * which is exactly the failure the memory exists to prevent.
 *
 * @throws {Error} When the file is not JSON, or is JSON that is not a `GradeMemory`.
 */
export const readGradeMemory = async ({ cwd, name }: Params): Promise<GradeMemory | undefined> => {
	const path = gradeMemoryPath({ cwd, name });

	if (!(await pathExists({ path }))) {
		return undefined;
	}

	const read = await readJson({ path });

	if ('failure' in read) {
		throw new Error(`the finding memory at ${path} is not readable JSON: ${read.failure}`);
	}

	const parsed = GradeMemory.safeParse(read.value);

	if (!parsed.success) {
		throw new Error(`the finding memory at ${path} is not a readable grade memory: ${parsed.error.message}`);
	}

	return parsed.data;
};
