import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { commitDirectRun } from '#src/cli/common/implementRun/commitDirectRun.ts';
import { committedPaths } from '#tests/helpers/committedPaths.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A real workspace holding the work, and a SEPARATE checkout standing in for
 * the one the command was launched from — where the run's records live. The two
 * are different directories on purpose: that split is the whole reason this
 * helper takes a run directory rather than deriving one from `cwd`.
 */
const setupDirectCommit = ({ dirty = true }: { dirty?: boolean } = {}) => {
	const { cwd: workspace } = setupBranchRepo(dirty ? { dirty: { 'thing.ts': 'export const thing = 1;\n' } } : {});
	const records = mkdtempSync(join(tmpdir(), 'lightsout-records-'));
	const runDir = join(records, '.lightsout', 'runs', 'run-1234-abcd');

	return { workspace, runDir };
};

describe('commitDirectRun', () => {
	test('the message file follows the run directory, not the checkout the work is in', async () => {
		const { workspace, runDir } = setupDirectCommit();

		const uncommitted = await commitDirectRun({
			cwd: workspace,
			ticketBody: '# Drain the backlog\n\nBuild the thing.\n',
			ticketRef: 'LO-70',
			runDir,
			generated: undefined,
			onProgress: () => undefined,
		});

		expect({
			uncommitted,
			message: readFileSync(join(runDir, 'commit-message.txt'), 'utf8'),
			// The path a run directory derived from the work checkout would have
			// produced — nothing may be written there.
			inWorkCheckout: existsSync(join(workspace, '.lightsout', 'runs', 'run-1234-abcd', 'commit-message.txt')),
			subject: headSubject({ cwd: workspace }),
			carried: committedPaths({ cwd: workspace }),
		}).toStrictEqual({
			uncommitted: undefined,
			message: 'LO-70 Drain the backlog\n',
			inWorkCheckout: false,
			subject: 'LO-70 Drain the backlog',
			carried: ['thing.ts'],
		});
	});

	test('a commit that changed nothing is a sentence and a commit that landed is silence', async () => {
		const clean = setupDirectCommit({ dirty: false });
		const dirty = setupDirectCommit();

		const changedNothing = await commitDirectRun({
			cwd: clean.workspace,
			ticketBody: '# Drain the backlog\n',
			ticketRef: 'LO-70',
			runDir: clean.runDir,
			generated: undefined,
			onProgress: () => undefined,
		});
		const landed = await commitDirectRun({
			cwd: dirty.workspace,
			ticketBody: '# Drain the backlog\n',
			ticketRef: 'LO-70',
			runDir: dirty.runDir,
			generated: undefined,
			onProgress: () => undefined,
		});

		expect({ changedNothing, landed }).toStrictEqual({ changedNothing: 'the worker changed nothing', landed: undefined });
	});
});
