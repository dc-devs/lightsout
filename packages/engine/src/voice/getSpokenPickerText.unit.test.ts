import { describe, expect, test } from '@jest/globals';
import { getSpokenPickerText } from '@/voice';

describe('getSpokenPickerText', () => {
	test('speaks the question, then every choice with the line that explains it', () => {
		const spoken = getSpokenPickerText({
			toolInput: {
				questions: [
					{
						question: 'Where should the switch live?',
						header: 'Placement',
						options: [
							{ label: 'in the project', description: 'follows the repo being planned' },
							{ label: 'in the home folder', description: 'one switch for every repo' },
						],
					},
				],
			},
		});

		expect(spoken).toBe(
			'Where should the switch live?\nOptions: in the project: follows the repo being planned. in the home folder: one switch for every repo',
		);
	});

	test('the decoration a voice cannot say is stripped, while a number sign inside a line is left alone', () => {
		const spoken = getSpokenPickerText({
			toolInput: {
				questions: [
					{
						question: 'Should the switch live in `.lightsout/voice-on`?',
						options: [{ label: '**yes**', description: 'the placement issue #5 settled on' }],
					},
				],
			},
		});

		expect(spoken).toBe('Should the switch live in .lightsout/voice-on?\nOptions: yes: the placement issue #5 settled on');
	});

	test('two questions are read one after the other, with a pause between them', () => {
		const spoken = getSpokenPickerText({
			toolInput: {
				questions: [
					{ question: 'Where should it live?', options: [{ label: 'in the project' }] },
					{ question: 'Should it start off?', options: [{ label: 'yes' }] },
				],
			},
		});

		expect(spoken).toBe('Where should it live?\nOptions: in the project\n\nShould it start off?\nOptions: yes');
	});

	test('a choice with nothing to add speaks its label alone, and a nameless one is dropped', () => {
		const spoken = getSpokenPickerText({
			toolInput: { questions: [{ question: 'Ready?', options: [{ label: 'yes' }, { label: '', description: 'unnamed' }] }] },
		});

		expect(spoken).toBe('Ready?\nOptions: yes');
	});

	// One outcome — the question still gets asked — reached by three ways of
	// losing the choices.
	test.each([
		{ label: 'choices that are not a list', question: { question: 'Ready?', options: 'nope' } },
		{ label: 'a list holding something that is not a choice', question: { question: 'Ready?', options: ['yes'] } },
		{ label: 'no choices at all', question: { question: 'Ready?' } },
	])('$label leaves the question asked on its own', ({ question }) => {
		const spoken = getSpokenPickerText({ toolInput: { questions: [question] } });

		expect(spoken).toBe('Ready?');
	});

	test.each([
		{ label: 'a question with no text of its own', question: { options: [{ label: 'yes' }] } },
		{ label: 'a question whose text is empty', question: { question: '', options: [{ label: 'yes' }] } },
	])('$label offers its choices without a lead-in', ({ question }) => {
		const spoken = getSpokenPickerText({ toolInput: { questions: [question] } });

		expect(spoken).toBe('Options: yes');
	});

	test.each([
		{ label: 'no questions field at all', toolInput: { header: 'Placement' } },
		{ label: 'a questions field that is not a list', toolInput: { questions: 'nope' } },
		{ label: 'a list holding something that is not a question', toolInput: { questions: ['nope'] } },
		{ label: 'an empty list', toolInput: { questions: [] } },
		{ label: 'input that is not an object at all', toolInput: 'nope' },
		// The two shapes a hook payload with no tool input of its own arrives in.
		{ label: 'no tool input at all', toolInput: undefined },
		{ label: 'tool input that is empty', toolInput: null },
	])('$label is not read aloud', ({ toolInput }) => {
		const spoken = getSpokenPickerText({ toolInput });

		expect(spoken).toBeUndefined();
	});
});
