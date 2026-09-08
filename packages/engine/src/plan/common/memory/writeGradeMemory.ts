import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { GradeMemory } from '#src/contracts/index.ts';
import { gradeMemoryPath } from '#src/plan/common/memory/gradeMemoryPath.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	memory: GradeMemory;
}

/**
 * Write the plan's finding memory, parsed against its own contract on the way
 * out so a malformed record can never reach disk and then refuse the next pass.
 * The same rule `appendGradeHistory` follows for the grade ledger.
 */
export const writeGradeMemory = async ({ cwd, name, memory }: Params): Promise<void> => {
	await writeJsonFile({ path: gradeMemoryPath({ cwd, name }), value: GradeMemory.parse(memory) });
};
