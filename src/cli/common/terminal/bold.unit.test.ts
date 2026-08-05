import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { bold } from '@/cli/common/terminal/bold';

// bold is an emphasis callback built over paint, so the only thing it decides
// is the ANSI code — observable on a TTY and nowhere else. isTTY is the whole
// arrangement, restored when the test ends.
const setupBold = ({ t, isTty }: { t: TestContext; isTty: boolean }) => {
	const wasTty = process.stdout.isTTY;

	process.stdout.isTTY = isTty;
	t.after(() => {
		process.stdout.isTTY = wasTty;
	});

	return { text: 'gates' };
};

test('bold: wraps the text in the bold ANSI code on a TTY', (t) => {
	const { text } = setupBold({ t, isTty: true });

	const painted = bold(text);

	assert.equal(painted, '\u001b[1mgates\u001b[0m');
});

test('bold: is a no-op when the output is piped', (t) => {
	const { text } = setupBold({ t, isTty: false });

	const painted = bold(text);

	assert.equal(painted, 'gates');
});
