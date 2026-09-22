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
		// a folder holding loose files takes the second form of the same command,
		// so the note naming that folder carries the same label
		expect(sentence).toContain('--from lo-158-a-branch-name');
		// every `lightsout <word>` span is that same command: a second one would be
		// a second thing to run, and `lightsout ticket` is no longer a command
		expect(sentence.match(/lightsout [a-z-]+/g)).toStrictEqual(['lightsout work-order']);
		// what is missing is the work order, not a ticket record — the tracker
		// vocabulary belongs to Linear and Jira and nothing here
		expect(sentence).not.toMatch(/ticket/i);
	});

	test('names the folder, the command that starts a plan under the work-order command word, and the --from form', () => {
		const sentence = describeMissingWorkOrder({ name: 'lo-140-x' });

		// the folder is named before anything else, because a reader who mistyped a
		// name has to see which one was looked for
		expect(sentence).toContain('lo-140-x');
		// the way out is a whole command a reader can retype from the sentence
		// alone: the subcommand, the folder as --name, and a placeholder telling
		// them the slug is theirs to choose
		expect(sentence).toContain('lightsout work-order add-plan --name lo-140-x --slug <slug>');
		// a folder holding loose files takes the second form of the same command,
		// so the note naming that folder stays beside the command
		expect(sentence).toContain('--from lo-140-x');
		expect(sentence).toMatch(/no work order/i);
	});

	test('spells one command and no other, so it sends nobody at a command word that no longer exists', () => {
		const sentence = describeMissingWorkOrder({ name: 'lo-158-a-branch-name' });

		// every `lightsout <word>` span in the sentence is the one command it
		// offers: a second one would be a second thing to run, and after the rename
		// `lightsout ticket` is not a command at all
		expect(sentence.match(/lightsout [a-z-]+/g)).toStrictEqual(['lightsout work-order']);
		// the folder reaches both the --name and the --from span, rather than one
		// of them being left at whatever the last reader's folder was called
		expect(sentence).toContain('--name lo-158-a-branch-name');
		expect(sentence).toContain('--from lo-158-a-branch-name');
	});
});
