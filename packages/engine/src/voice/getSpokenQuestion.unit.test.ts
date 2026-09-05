import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getSpokenQuestion } from '#src/voice/index.ts';

// The transcript is a real JSONL file in a temp folder: the shape the harness
// writes is the whole contract here, so reading a stub of it would prove
// nothing about the file the hook actually gets pointed at.
const setupTranscript = ({ lines }: { lines: string[] }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-spoken-question-'));
	const transcriptPath = join(dir, 'transcript.jsonl');

	writeFileSync(transcriptPath, `${lines.join('\n')}\n`);

	return { dir, transcriptPath };
};

const assistantSaying = ({ text, sidechain = false }: { text: string; sidechain?: boolean }) =>
	JSON.stringify({ type: 'assistant', isSidechain: sidechain, message: { content: [{ type: 'text', text }] } });

const assistantPicking = ({ question }: { question: string }) =>
	JSON.stringify({
		type: 'assistant',
		message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question, options: [] }] } }] },
	});

const userSaying = ({ text }: { text: string }) => JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });

/** The other shape a typed reply arrives in: the content is the string itself, with no blocks around it. */
const userTyping = ({ text }: { text: string }) => JSON.stringify({ type: 'user', message: { content: text } });

const userToolResult = () => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });

/** The harness's own bookkeeping, which is neither the model speaking nor the person typing. */
const systemNote = () => JSON.stringify({ type: 'system', subtype: 'post_tool_use_hook', content: 'ran a hook' });

const placementQuestion = [
	'## Placement',
	'',
	'**Context:** the switch lives in `.lightsout/voice-on`.',
	'',
	'**Question:** should it be per project?',
	'',
	'',
	'**Recommendation:** yes, per project.',
].join('\n');

const spokenPlacementQuestion = [
	'Placement',
	'',
	'Context: the switch lives in .lightsout/voice-on.',
	'',
	'Question: should it be per project?',
	'',
	'Recommendation: yes, per project.',
].join('\n');

const defaultQuestion = ['**Question:** should it start off?', '', '**Options:** silence by default costs one step.'].join('\n');

const spokenDefaultQuestion = ['Question: should it start off?', '', 'Options: silence by default costs one step.'].join('\n');

describe('getSpokenQuestion', () => {
	test('reads back the whole labelled block with the decoration a voice cannot say stripped out', async () => {
		const { transcriptPath } = setupTranscript({ lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: placementQuestion })] });

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBe(spokenPlacementQuestion);
	});

	test('two questions in one turn are read one after the other, with a pause between them', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: placementQuestion }), assistantSaying({ text: defaultQuestion })],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBe(`${spokenPlacementQuestion}\n\n${spokenDefaultQuestion}`);
	});

	test('an option picker in the turn is left alone, because it was already read when it appeared', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [userSaying({ text: 'plan it' }), assistantPicking({ question: 'Where should the switch live?' })],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBeUndefined();
	});

	test('a turn that only reports progress is not read aloud', async () => {
		const { transcriptPath } = setupTranscript({ lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: 'Wrote the plan.' })] });

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBeUndefined();
	});

	test('a bare question label with none of the parts that make it answerable is not read aloud', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: '**Question:** ready to move on?' })],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBeUndefined();
	});

	test('a question the user already answered is not read again', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [
				userSaying({ text: 'plan it' }),
				assistantSaying({ text: placementQuestion }),
				userTyping({ text: 'per project' }),
				assistantSaying({ text: 'Noted.' }),
			],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBeUndefined();
	});

	test('a tool result mid-turn does not end the turn, so the question before it is still read', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [
				userSaying({ text: 'plan it' }),
				assistantSaying({ text: placementQuestion }),
				userToolResult(),
				assistantSaying({ text: 'Checked the folder.' }),
			],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBe(spokenPlacementQuestion);
	});

	test('a harness bookkeeping line mid-turn is neither read aloud nor treated as the end of the turn', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: placementQuestion }), systemNote(), assistantSaying({ text: 'Checked the folder.' })],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBe(spokenPlacementQuestion);
	});

	test('a question a subagent asked itself is never read aloud', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: placementQuestion, sidechain: true }), assistantSaying({ text: 'Done.' })],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBeUndefined();
	});

	test('a question in the opening turn is read, with no typed message ahead of it to mark where the turn began', async () => {
		const { transcriptPath } = setupTranscript({ lines: [assistantSaying({ text: placementQuestion })] });

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBe(spokenPlacementQuestion);
	});

	test('lines the transcript half-wrote are skipped rather than losing the question beside them', async () => {
		const { transcriptPath } = setupTranscript({
			lines: [userSaying({ text: 'plan it' }), '{"type":"assistant","message":', '{"type":"assistant"}', assistantSaying({ text: placementQuestion })],
		});

		const spoken = await getSpokenQuestion({ transcriptPath });

		expect(spoken).toBe(spokenPlacementQuestion);
	});

	test('a transcript that is not there reads as no question, never as a failure', async () => {
		const { dir } = setupTranscript({ lines: [] });

		const spoken = await getSpokenQuestion({ transcriptPath: join(dir, 'missing.jsonl') });

		expect(spoken).toBeUndefined();
	});
});
