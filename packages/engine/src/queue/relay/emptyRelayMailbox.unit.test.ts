import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { emptyRelayMailbox } from '#src/queue/relay/index.ts';

/** A throwaway parent, so a mailbox that has never existed and one full of leftovers are both reachable. */
const setupMailbox = () => join(mkdtempSync(join(tmpdir(), 'lightsout-mailbox-')), 'relay');

describe('emptyRelayMailbox', () => {
	test('creates the mailbox when the repo has never run a file relay before', async () => {
		const directory = setupMailbox();

		await emptyRelayMailbox({ directory });

		expect(readdirSync(directory)).toStrictEqual([]);
	});

	test('removes what a crashed drain left, so a file in the mailbox always means a live question', async () => {
		const directory = setupMailbox();

		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, 'lo-70-1.question.json'), '{}', 'utf8');
		writeFileSync(join(directory, 'lo-70-1.answer.json'), '{}', 'utf8');

		await emptyRelayMailbox({ directory });

		expect(readdirSync(directory)).toStrictEqual([]);
	});

	test('removes a directory somebody left in the mailbox too, rather than failing on it', async () => {
		const directory = setupMailbox();

		mkdirSync(join(directory, 'notes'), { recursive: true });
		writeFileSync(join(directory, 'notes', 'stray.txt'), 'x', 'utf8');

		await emptyRelayMailbox({ directory });

		expect(existsSync(join(directory, 'notes'))).toBe(false);
	});
});
