import { describe, expect, test } from '@jest/globals';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';
import { planWorkspaceCommand } from '#src/cli/plan/planWorkspaceCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// The command is handed a tree `planCommand` already resolved, and by then the
// wrapper has announced the move on stdout. The arrangement writes that same
// announcement first, through the same captured stream, so the assertion can
// prove the path lands below it rather than merely somewhere in the output.
const setupWorkspace = () => {
	const captured = captureCommandOutput();
	const worktree: PlanWorktree = { cwd: '/repo/.worktrees/lo-131-demo', branch: 'lo-131-demo', isolated: true, created: true };

	console.log(`lightsout: workspace ${worktree.cwd}\n  branch: ${worktree.branch}`);

	return { worktree, ...captured };
};

describe('planWorkspaceCommand', () => {
	test('writes the resolved path alone on the last stdout line and exits 0', async () => {
		const { worktree, logged, errors, exitCodes } = setupWorkspace();

		await expect(planWorkspaceCommand({ worktree })).rejects.toThrow(/process\.exit/);

		const stdoutLines = logged.join('\n').split('\n');
		expect(stdoutLines.at(-1)).toBe('/repo/.worktrees/lo-131-demo');
		expect(stdoutLines.slice(0, 2)).toStrictEqual(['lightsout: workspace /repo/.worktrees/lo-131-demo', '  branch: lo-131-demo']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});
});
