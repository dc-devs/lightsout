import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readLastProgressMessage } from '#src/runState/index.ts';

const runId = 'run-narrated';

/** A repo holding one run whose progress log is exactly the given file body. */
const setupProgressLog = ({ body }: { body?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-progress-log-'));

	mkdirSync(join(cwd, '.lightsout', 'runs', runId), { recursive: true });

	if (body !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'runs', runId, 'progress.jsonl'), body, 'utf8');
	}

	return { cwd };
};

/** One narrated line as the sink writes it. */
const lineOf = ({ message }: { message: string }) => `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', message })}\n`;

describe('readLastProgressMessage', () => {
	test('answers the last line the run narrated, which is what it is doing now', async () => {
		const { cwd } = setupProgressLog({ body: `${lineOf({ message: 'step implement' })}${lineOf({ message: 'step refactor — pass 1/3' })}` });

		expect(await readLastProgressMessage({ cwd, runId })).toBe('step refactor — pass 1/3');
	});

	test('a run that has narrated nothing reads as undefined rather than as an empty line', async () => {
		const { cwd } = setupProgressLog();

		expect(await readLastProgressMessage({ cwd, runId })).toBeUndefined();
	});

	test('a malformed trailing line is skipped, so the last readable line still answers', async () => {
		const { cwd } = setupProgressLog({ body: `${lineOf({ message: 'step implement' })}{ not json\n` });

		// a half-written line is evidence of a crash mid-append, never a message
		expect(await readLastProgressMessage({ cwd, runId })).toBe('step implement');
	});

	test('a line that parses but fails the contract is skipped too', async () => {
		const { cwd } = setupProgressLog({ body: `${lineOf({ message: 'step implement' })}${JSON.stringify({ message: 'no timestamp' })}\n` });

		expect(await readLastProgressMessage({ cwd, runId })).toBe('step implement');
	});

	test('a log holding only unreadable lines reads as undefined', async () => {
		const { cwd } = setupProgressLog({ body: '{ not json\n' });

		expect(await readLastProgressMessage({ cwd, runId })).toBeUndefined();
	});
});
