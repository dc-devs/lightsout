import { afterEach, describe, expect, test } from '@jest/globals';
import { isPublicDeployment } from '#src/common/utils/isPublicDeployment.ts';

const setupFlag = ({ value }: { value?: string }) => {
	if (value === undefined) {
		delete process.env.LIGHTSOUT_PUBLIC;
	} else {
		process.env.LIGHTSOUT_PUBLIC = value;
	}
};

afterEach(() => {
	delete process.env.LIGHTSOUT_PUBLIC;
});

describe('isPublicDeployment', () => {
	test('reads 1 as the public site', () => {
		setupFlag({ value: '1' });

		const answer = isPublicDeployment();

		expect(answer).toBe(true);
	});

	test.each([
		{ label: 'unset', value: undefined },
		{ label: 'empty', value: '' },
		{ label: '0', value: '0' },
	])('reads $label as a local dev server', ({ value }) => {
		setupFlag({ value });

		const answer = isPublicDeployment();

		expect(answer).toBe(false);
	});

	test.each(['true', 'yes', 'TRUE', ' 1', 'public'])('refuses %p rather than guessing a side, naming the value and the fix', (value) => {
		setupFlag({ value });

		const read = () => isPublicDeployment();

		expect(read).toThrow(`LIGHTSOUT_PUBLIC is '${value}' — set it to 1 for the public site, or leave it unset (or 0) for a local dev server.`);
	});
});
