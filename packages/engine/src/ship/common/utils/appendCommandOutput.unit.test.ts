import { describe, expect, test } from '@jest/globals';
import { appendCommandOutput } from '#src/ship/common/utils/appendCommandOutput.ts';

const setupNoisyStderr = () => {
	const token = `ghp_${'a'.repeat(24)}`;
	const sentence = "git could not push 'lo-89-centralize-ship-integration' to origin";
	const stderr = `remote: fatal: could not read from https://dc-devs:${token}@github.com/dc-devs/lightsout.git\n${'noise '.repeat(150)}`;

	return { sentence, stderr, token };
};

describe('appendCommandOutput', () => {
	test('masks credentials and caps the tail after the move out of runShip', () => {
		const { sentence, stderr, token } = setupNoisyStderr();

		const appended = appendCommandOutput({ sentence, stderr });
		const unchanged = appendCommandOutput({ sentence, stderr: '' });

		expect(appended).not.toContain(token);
		expect(appended).not.toContain('dc-devs:');
		expect(appended).toContain('https://***@github.com/dc-devs/lightsout.git');
		expect(appended.startsWith(`${sentence}: `)).toBe(true);
		expect(appended.endsWith('…')).toBe(true);
		expect(appended).toHaveLength(`${sentence}: `.length + 501);
		expect(unchanged).toBe(sentence);
	});

	test('masks a bare token wearing no URL, and trims the blank lines around what the command said', () => {
		const sentence = "no pull request could be opened or read for 'lo-89-centralize-ship-integration'";

		const bareToken = appendCommandOutput({ sentence, stderr: `remote: the token ghs_${'b'.repeat(24)} was rejected` });
		const padded = appendCommandOutput({ sentence, stderr: '\n  gh: no write access\n\n' });

		expect(bareToken).toBe(`${sentence}: remote: the token *** was rejected`);
		expect(padded).toBe(`${sentence}: gh: no write access`);
	});
});
