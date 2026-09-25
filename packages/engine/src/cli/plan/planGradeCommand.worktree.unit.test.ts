import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { planGradeCommand } from '#src/cli/plan/planGradeCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// `plan grade` run from a linked worktree: the three paths it prints are the
// primary checkout's own, because that is where the plan folder lives now.

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

const name = 'demo';

/**
 * A committed consumer repo holding one plan folder, with a linked worktree cut
 * from its HEAD — the shape `plan.worktree` puts a grade in. The plan folder was
 * written after the repo's only commit, so the tree holds no copy of it and the
 * command can only report a graded plan by reading the primary checkout.
 * `realpathSync` on the primary because macOS's temp dir is a symlink, and the
 * paths the command prints come back resolved.
 */
const setupWorktreeGrade = () => {
	const captured = captureCommandOutput();
	const primary = realpathSync(setupConsumerRepo());
	const worktree = join(mkdtempSync(join(tmpdir(), 'lightsout-plan-grade-tree-')), 'tree');

	writePlanDeliverable({ cwd: primary, name, body: cleanPlanBody() });
	execSync(`git worktree add -q -b ${name} "${worktree}" HEAD`, { cwd: primary, stdio: 'ignore' });

	return { primary, worktree, driver: createGapCheckDriver(), ...captured };
};

describe('planGradeCommand', () => {
	test("a grade run from a linked worktree prints the primary checkout's grade, history and memory paths", async () => {
		const { primary, worktree, driver, logged, errors, exitCodes } = setupWorktreeGrade();

		await expect(planGradeCommand({ cwd: worktree, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

		const printed = printedLines({ logged });
		const planDir = planWorkspaceFolder({ cwd: primary, name: name });

		// the plan was found at all: a grade that resolved the folder against the
		// worktree reports no plan there and grades nothing
		expect(printed[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
		// all three paths name the folder that outlives the tree, so a human is sent
		// to files that are really there
		expect(printed.slice(-3)).toStrictEqual([
			`\ngrade: ${join(planDir, 'grade.json')}`,
			`history: ${join(planDir, 'grade-history.jsonl')}`,
			`memory: ${join(planDir, 'grade-memory.json')}`,
		]);
		// and the tree the grade ran in was left with no plan data of its own
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});
});
