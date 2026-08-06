import { expect, test } from '@jest/globals';
import { bold } from '@/cli/common/terminal/bold';

// bold is an emphasis callback built over paint, so the only thing it decides
// is the ANSI code — observable on a TTY and nowhere else. isTTY is the whole
// arrangement, restored when the test ends.
const setupBold = ({ isTty }: { isTty: boolean }) => {
	process.stdout.isTTY = isTty;

	return { text: 'gates' };
};

test('bold: wraps the text in the bold ANSI code on a TTY', () => {
	const { text } = setupBold({ isTty: true });

	const painted = bold(text);

	expect(painted).toBe('\u001b[1mgates\u001b[0m');
});

test('bold: is a no-op when the output is piped', () => {
	const { text } = setupBold({ isTty: false });

	const painted = bold(text);

	expect(painted).toBe('gates');
});
