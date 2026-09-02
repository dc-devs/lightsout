import { describe, expect, jest, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { runFormatter } from '#src/common/processes/runFormatter.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setupFormatter = async ({ format }: { format?: string } = {}) => {
	const cwd = setupConsumerRepo({ scripts: format === undefined ? {} : { format } });
	const config = await readConfig({ cwd });
	const onResult = jest.fn<(result: GateResult) => void>();
	const runId = 'formatter-run';
	const step = 'verify-implement';

	return { cwd, onResult, args: { cwd, config, runId, step, onResult } };
};

describe('runFormatter', () => {
	test('reports the same successful command evidence that it persists', async () => {
		const { cwd, onResult, args } = await setupFormatter({ format: 'true' });

		const error = await runFormatter(args);

		const [persisted] = readCommandLog(cwd, args.runId);
		expect(error).toBeUndefined();
		expect(onResult).toHaveBeenCalledTimes(1);
		expect(onResult).toHaveBeenCalledWith({
			group: 'root',
			kind: 'format',
			command: 'true',
			exitCode: 0,
			durationMs: expect.any(Number),
		});
		expect(persisted).toEqual({
			at: expect.any(String),
			step: 'verify-implement',
			...onResult.mock.calls[0]?.[0],
		});
	});

	test('reports a red formatter with the bounded output tail used by recovery', async () => {
		const command = `node -e "process.stderr.write('x'.repeat(2100) + 'TAIL'); process.exit(7)"`;
		const { onResult, args } = await setupFormatter({ format: command });

		const error = await runFormatter(args);

		expect(error).toContain('format failed (exit 7)');
		expect(error).toContain(`${'x'.repeat(2100)}TAIL`);
		expect(onResult).toHaveBeenCalledTimes(1);
		expect(onResult).toHaveBeenCalledWith({
			group: 'root',
			kind: 'format',
			command,
			exitCode: 7,
			durationMs: expect.any(Number),
			outputTail: `${'x'.repeat(1996)}TAIL`,
		});
	});

	test('a missing formatter remains a silent success with no synthetic evidence', async () => {
		const { cwd, onResult, args } = await setupFormatter();

		const error = await runFormatter(args);
		const commands = readCommandLog(cwd, args.runId);

		expect(error).toBeUndefined();
		expect(onResult).not.toHaveBeenCalled();
		expect(commands).toStrictEqual([]);
	});
});
