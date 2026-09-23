import { describe, expect, test } from '@jest/globals';
import { describeMissingWorkOrder } from '#src/common/utils/describeMissingWorkOrder.ts';

describe('describeMissingWorkOrder', () => {
	test('describeMissingWorkOrder: names the label and the command that starts its first plan', () => {
		const sentence = describeMissingWorkOrder({ name: 'lo-158-a-branch-name' });

		// the label is in the sentence, because a reader who mistyped one has to
		// see which one was looked for
		expect(sentence).toContain('lo-158-a-branch-name');
		// the way out is a command a reader can retype, and it is the one command
		// that starts a work order's first plan
		expect(sentence).toContain('lightsout work-order add-plan');
		// the label reaches the flag that names which work order, rather than the
		// command being offered with somebody else's label in it
		expect(sentence).toContain('--name lo-158-a-branch-name');
		// nothing names a source folder any more: a work order with no record is
		// simply one nobody has started
		expect(sentence).not.toContain('--from');
		// every `lightsout <word>` span is that same command: a second one would be
		// a second thing to run, and `lightsout ticket` is no longer a command
		expect(sentence.match(/lightsout [a-z-]+/g)).toStrictEqual(['lightsout work-order']);
		// what is missing is the work order, not a ticket record — the tracker
		// vocabulary belongs to Linear and Jira and nothing here
		expect(sentence).not.toMatch(/ticket/i);
	});

	test('names the folder and the command that starts a plan under the work-order command word', () => {
		const sentence = describeMissingWorkOrder({ name: 'lo-140-x' });

		// the folder is named before anything else, because a reader who mistyped a
		// name has to see which one was looked for
		expect(sentence).toContain('lo-140-x');
		// the way out is a whole command a reader can retype from the sentence
		// alone: the subcommand, the folder as --name, and a placeholder telling
		// them the slug is theirs to choose
		expect(sentence).toContain('lightsout work-order add-plan --name lo-140-x --slug <slug>');
		expect(sentence).not.toContain('--from');
		expect(sentence).toMatch(/no work order/i);
	});

	test('spells one command and no other, so it sends nobody at a command word that no longer exists', () => {
		const sentence = describeMissingWorkOrder({ name: 'lo-158-a-branch-name' });

		// every `lightsout <word>` span in the sentence is the one command it
		// offers: a second one would be a second thing to run, and after the rename
		// `lightsout ticket` is not a command at all
		expect(sentence.match(/lightsout [a-z-]+/g)).toStrictEqual(['lightsout work-order']);
		// the folder reaches the --name span, rather than the command being offered
		// with whatever the last reader's folder was called
		expect(sentence).toContain('--name lo-158-a-branch-name');
	});
});
