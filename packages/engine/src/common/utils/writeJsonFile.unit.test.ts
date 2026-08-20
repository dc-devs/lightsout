import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';

const setupTarget = ({ existing }: { existing?: string } = {}) => {
	const path = join(mkdtempSync(join(tmpdir(), 'lightsout-writejson-')), 'manifest.json');

	if (existing !== undefined) {
		writeFileSync(path, existing);
	}

	return { path };
};

test('writeJsonFile: the value lands tab-indented with a trailing newline', async () => {
	const { path } = setupTarget();

	await writeJsonFile({ path, value: { id: 'run-1', steps: [{ name: 'check', ok: true }] } });

	expect(readFileSync(path, 'utf8')).toBe('{\n\t"id": "run-1",\n\t"steps": [\n\t\t{\n\t\t\t"name": "check",\n\t\t\t"ok": true\n\t\t}\n\t]\n}\n');
});

test('writeJsonFile: an existing file is replaced whole, never appended to', async () => {
	const { path } = setupTarget({ existing: '{\n\t"id": "a much longer stale manifest that must not survive"\n}\n' });

	await writeJsonFile({ path, value: { ok: true } });

	expect(readFileSync(path, 'utf8')).toBe('{\n\t"ok": true\n}\n');
});
