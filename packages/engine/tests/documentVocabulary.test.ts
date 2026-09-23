import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

// The vocabulary the repository's own documents teach.
//
// Every phase before this one moved the folder, renamed the record and renamed
// the command word. A document left spelling the old shape is worse than an
// out-of-date comment: it tells a human to type a command the engine refuses,
// or to open a file no engine writes. These are the thirteen documents that
// carry that vocabulary, and each case here bans one retired spelling across
// all of them at once.
//
// The bans are literal substrings and one regular expression, never a bare-word
// match. The two tracker skills say `ticket` legitimately on nearly every line —
// labels, statuses, issue types — and a case that banned the word itself could
// never pass. What is banned is a phrase that names the folder, its record, its
// plans or its branch; `lightsout ticket-state`, the `ticket-tracker` config
// block and `ship.ticket-pattern` all name the tracker and stay.
//
// This reads and never writes, so unlike buildConfigKeyReference.test.ts it
// needs no throwaway repository root.
//
// It sits in tests/ rather than beside a source file for the same reason that
// file does: its subject is a set of repository-root documents, outside src/,
// naming nothing next to it.

const repoRoot = join(__dirname, '..', '..', '..');

/** The thirteen documents this phase rewrites — the tour, the configuration reference, the repository's own instructions, the seven engine skills, the two tracker skills and the generated router. */
const documentPaths = [
	'README.md',
	'docs/configuration.md',
	'CLAUDE.md',
	'plugin/skills/ticket-workflow/SKILL.md',
	'plugin/skills/brainstorm/SKILL.md',
	'plugin/skills/plan/SKILL.md',
	'plugin/skills/auto-plan/SKILL.md',
	'plugin/skills/queue/SKILL.md',
	'plugin/skills/implement/SKILL.md',
	'plugin/skills/status/SKILL.md',
	'plugin-linear/skills/linear-ticket/SKILL.md',
	'plugin-jira/skills/jira-ticket/SKILL.md',
	'plugin/prompts/ticket-workflow.md',
];

const documents = documentPaths.map((path) => ({ path, text: readFileSync(join(repoRoot, path), 'utf8') }));

/**
 * Every place one of `banned` appears, named by its document, its line number,
 * the phrase it held and the line that holds it — so a failure reads as the
 * repair to make rather than as a false boolean.
 *
 * `ignoreCase` is how a phrase is caught in a heading as well as in a sentence:
 * `### Ticket folders and plan ids` names the same retired thing as `a ticket
 * folder holds its plans`, and a rename that fixed only the lower-case
 * sentences would leave the heading standing.
 */
const findBannedPhrases = ({ banned, ignoreCase = false }: { banned: string[]; ignoreCase?: boolean }) =>
	documents.flatMap(({ path, text }) =>
		text.split('\n').flatMap((line, index) => {
			const haystack = ignoreCase ? line.toLowerCase() : line;

			return banned
				.filter((phrase) => haystack.includes(ignoreCase ? phrase.toLowerCase() : phrase))
				.map((phrase) => ({ file: path, line: index + 1, held: phrase, text: line.trim() }));
		}),
	);

/** Every place a document spells the retired `lightsout ticket` command word, reading `lightsout ticket-state` as the tracker command it still is. */
const findRetiredCommandWord = () =>
	documents.flatMap(({ path, text }) =>
		text
			.split('\n')
			.flatMap((line, index) =>
				[...line.matchAll(/lightsout ticket(?!-state)/g)].map((match) => ({ file: path, line: index + 1, held: match[0], text: line.trim() })),
			),
	);

/** The documents that do NOT hold `phrase` — the inverse of the bans, for the one sentence two documents have to teach. */
const findDocumentsMissing = ({ phrase, paths }: { phrase: string; paths: string[] }) =>
	documents.filter(({ path, text }) => paths.includes(path) && !text.includes(phrase)).map(({ path }) => path);

describe('document vocabulary', () => {
	test('no document names the retired .lightsout/tickets folder', () => {
		const offences = findBannedPhrases({ banned: ['.lightsout/tickets'] });

		expect(offences).toStrictEqual([]);
	});

	test('no document names a record file the rename retired', () => {
		const offences = findBannedPhrases({ banned: ['ticket.json', 'ticket.published.json'] });

		expect(offences).toStrictEqual([]);
	});

	test('no document spells the retired lightsout ticket command word, and ticket-state still passes', () => {
		const offences = findRetiredCommandWord();
		const trackerCommandDocuments = findDocumentsMissing({ phrase: 'lightsout ticket-state', paths: ['README.md'] });

		expect(offences).toStrictEqual([]);
		expect(trackerCommandDocuments).toStrictEqual([]);
	});

	test('no document calls a work order a ticket folder, a ticket branch or a ticket record', () => {
		const offences = findBannedPhrases({ banned: ['ticket folder', 'ticket branch', 'ticket-branch', 'ticket record'], ignoreCase: true });

		expect(offences).toStrictEqual([]);
	});

	test('no document names the renamed config key or the deleted plan-source flag', () => {
		const offences = findBannedPhrases({ banned: ['default-ticket-mode', 'add-plan --from'] });

		expect(offences).toStrictEqual([]);
	});

	test('the tour and the workflow skill both document lightsout work-order new', () => {
		const missing = findDocumentsMissing({ phrase: 'lightsout work-order new', paths: ['README.md', 'plugin/skills/ticket-workflow/SKILL.md'] });

		expect(missing).toStrictEqual([]);
	});
});
