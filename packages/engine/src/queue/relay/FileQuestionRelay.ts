import { readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { RelayAnswer, RelayQuestion } from '#src/contracts/index.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { recordRelayedAnswer } from '#src/queue/relay/recordRelayedAnswer.ts';

/** Said both by an `ask` that arrives after `close`, and by a wait `close` cuts short — one fact, one wording. */
const relayClosedMessage = 'the question relay is closed — no answer can arrive';

/** JSON, or undefined when the text is not JSON at all — a writer mid-write is a normal thing to read. */
const readJson = ({ raw }: { raw: string }) => {
	try {
		const value: unknown = JSON.parse(raw);

		return value;
	} catch {
		return undefined;
	}
};

/**
 * The answer waiting at this path, or undefined while there is none.
 *
 * A missing file, a half-written one, and one holding a blank answer are all
 * the same "not yet": parking a ticket on a transient read would turn a race
 * into lost work, and a blank answer is one a worker would act on.
 */
const readRelayAnswer = async ({ path }: { path: string }) => {
	const raw = await readFile(path, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	const parsed = RelayAnswer.safeParse(readJson({ raw }));
	const answer = parsed.success ? parsed.data.answer.trim() : '';

	return answer === '' ? undefined : answer;
};

/**
 * Both halves of one exchange, gone.
 *
 * A question file outlives its answer only as litter, and an answer left beside
 * a question nobody waits for reads as live to the next mailbox reader.
 */
const removeExchange = async ({ questionPath, answerPath }: { questionPath: string; answerPath: string }) => {
	await rm(questionPath, { force: true });
	await rm(answerPath, { force: true });
};

interface ConstructorParams {
	settings: QueueSettings;
	/** Absolute path to the mailbox, already created and emptied by the CLI. */
	directory: string;
	/** Where every worker's progress line is written — `process.stdout` in the CLI, a stream in tests. */
	output: NodeJS.WritableStream;
}

/**
 * Questions as files, answers as files beside them.
 *
 * Deliberately NOT serialized, unlike `TerminalQuestionRelay`: the terminal
 * serializes because there is one screen and one cursor, and a mailbox has
 * neither. Up to `max-parallel` questions may wait at once, which is what makes
 * the mailbox worth having — the reader answers them in whatever order suits.
 */
export class FileQuestionRelay implements QuestionRelay {
	private readonly settings: QueueSettings;
	private readonly directory: string;
	private readonly output: NodeJS.WritableStream;
	// One question file per ticket is not enough: a worker may be answered and
	// ask again, and the second question must not overwrite the first.
	private sequence = 0;
	private closed = false;
	private readonly abandonWaits = new Set<(error: Error) => void>();

	constructor({ settings, directory, output }: ConstructorParams) {
		this.settings = settings;
		this.directory = directory;
		this.output = output;
	}

	async ask({
		question,
		ticket,
		coordinatorRunId,
		coordinatorRunDir,
	}: {
		question: string;
		ticket: TicketSummary;
		coordinatorRunId: string;
		coordinatorRunDir: string;
	}): Promise<string> {
		if (this.closed) {
			throw new Error(relayClosedMessage);
		}

		this.sequence += 1;

		const stem = `${ticket.identifier.toLowerCase()}-${this.sequence}`;
		const questionPath = join(this.directory, `${stem}.question.json`);
		const answerPath = join(this.directory, `${stem}.answer.json`);

		await this.putQuestion({ stem, questionPath, question, ticket });

		const answer = await this.waitForAnswer({ questionPath, answerPath, question });

		await removeExchange({ questionPath, answerPath });
		await recordRelayedAnswer({
			settings: this.settings,
			question,
			answer,
			ticket,
			coordinatorRunId,
			coordinatorRunDir,
			onProgress: this.createProgressSink({ ticket }),
		});

		return answer;
	}

	/** No hold-and-flush buffer, unlike the terminal relay: nothing is on screen waiting to be typed over. */
	createProgressSink({ ticket }: { ticket: TicketSummary }): (message: string) => void {
		return (message: string) => {
			this.output.write(`${ticket.identifier} · ${message}\n`);
		};
	}

	close(): void {
		this.closed = true;

		for (const abandon of [...this.abandonWaits]) {
			abandon(new Error(relayClosedMessage));
		}

		this.abandonWaits.clear();
	}

	/** The question file, written under a temporary name and renamed in — a watcher globbing `*.question.json` must never read half of one. */
	private async putQuestion({ stem, questionPath, question, ticket }: { stem: string; questionPath: string; question: string; ticket: TicketSummary }) {
		const entry = RelayQuestion.parse({ ticket: ticket.identifier, title: ticket.title, question, askedAt: new Date().toISOString() });
		const temporaryPath = join(this.directory, `${stem}.tmp`);

		await writeJsonFile({ path: temporaryPath, value: entry });
		await rename(temporaryPath, questionPath);

		this.createProgressSink({ ticket })(`waiting for an answer in ${questionPath}`);
	}

	/**
	 * The answer file's contents once it holds one.
	 *
	 * @throws {Error} When the question timeout elapses — both files are removed
	 * first, so a late or blank answer never lingers to look live — or when the
	 * relay closes under the wait.
	 */
	private async waitForAnswer({ questionPath, answerPath, question }: { questionPath: string; answerPath: string; question: string }) {
		// A human answer takes minutes, so polling costs nothing — and it works
		// everywhere, which `fs.watch` does not.
		const pollMs = 2000;
		const deadline = Date.now() + this.settings.questionTimeoutMs;
		let timer: NodeJS.Timeout | undefined;
		let abandon: (error: Error) => void = () => undefined;
		const abandoned = new Promise<never>((_resolve, reject) => {
			abandon = (error: Error) => {
				clearTimeout(timer);
				reject(error);
			};
		});

		// The race below attaches the real handler; this one only keeps a close
		// landing between two ticks from reading as an unhandled rejection.
		abandoned.catch(() => undefined);
		this.abandonWaits.add(abandon);

		try {
			for (;;) {
				const answer = await readRelayAnswer({ path: answerPath });

				if (answer !== undefined) {
					return answer;
				}

				if (Date.now() >= deadline) {
					await removeExchange({ questionPath, answerPath });

					throw new Error(`no answer arrived within ${this.settings.questionTimeoutMs}ms for: ${question}`);
				}

				await Promise.race([
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, pollMs);
					}),
					abandoned,
				]);
			}
		} finally {
			clearTimeout(timer);
			this.abandonWaits.delete(abandon);
		}
	}
}
