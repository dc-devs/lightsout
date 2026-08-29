import { createInterface, type Interface } from 'node:readline/promises';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { recordRelayedAnswer } from '#src/queue/relay/recordRelayedAnswer.ts';

/** Said both by a drain whose input was closed before it asked, and by one whose terminal went away mid-question — one fact, one wording. */
const noTerminalMessage = 'there is no terminal to answer on — run `lightsout queue` attached to one';

interface ConstructorParams {
	settings: QueueSettings;
	/** Where prompts are printed and answers are typed — `process.stdin` in the CLI, a stream in tests. */
	input: NodeJS.ReadableStream;
	/** Where prompts and every worker's progress line are written. */
	output: NodeJS.WritableStream;
}

/**
 * The one terminal, shared by every worker in a drain.
 *
 * A class rather than a function because it holds state across calls: the
 * readline interface, the chain that keeps two workers from writing over each
 * other's prompt, and the buffer that holds progress back while a question is
 * on screen. Without that buffer a question is scrolled away by the other
 * in-flight workers, which defeats the one-terminal contract the queue is
 * built on.
 *
 * The terminal implementation of the `QuestionRelay` interface: the one a drain
 * started in a terminal uses, and the default when no mailbox was asked for.
 */
export class TerminalQuestionRelay implements QuestionRelay {
	private readonly settings: QueueSettings;
	private readonly output: NodeJS.WritableStream;
	private readonly terminal: Interface;
	// Each `ask` awaits its predecessor, so the terminal never holds two
	// half-written prompts.
	private chain: Promise<unknown> = Promise.resolve();
	private prompting = false;
	private held: string[] = [];
	private ended = false;
	private abandonPrompt?: (error: Error) => void;

	constructor({ settings, input, output }: ConstructorParams) {
		this.settings = settings;
		this.output = output;
		this.terminal = createInterface({ input, output });
		// A drain started with no terminal attached ends its input immediately.
		// Without this the open question would wait forever on a line nobody can
		// type, and the whole drain would hang on one ticket.
		this.terminal.on('close', () => {
			this.ended = true;
			this.abandonPrompt?.(new Error(noTerminalMessage));
		});
	}

	/**
	 * Put one worker's question to the user and answer with what they typed.
	 *
	 * Serialized: a second caller waits until the first answer is in. The answer
	 * is on disk and on the ticket before this resolves, so a worker never acts
	 * on a decision nothing recorded.
	 *
	 * @throws {Error} When there is no terminal to answer on (EOF or a closed input).
	 */
	ask({
		question,
		ticket,
		coordinatorRunId,
		coordinatorRunDir,
	}: {
		question: string;
		ticket: TicketSummary;
		/** The coordinator run's id — `appendJsonlRecords` stamps it on every record. */
		coordinatorRunId: string;
		/** The queue's own run directory in the main checkout — the one place the queue writes records. */
		coordinatorRunDir: string;
	}): Promise<string> {
		const answered = this.chain
			.then(() => this.putQuestion({ question, ticket }))
			.then(async (answer) => {
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
			});

		// The chain must survive a rejected ask: a ticket that could not be
		// answered parks, and every other in-flight worker keeps its turn.
		this.chain = answered.catch(() => undefined);

		return answered;
	}

	/**
	 * This ticket's progress writer: every line carries the ticket identifier and
	 * goes through the relay's buffer, so an open question is never buried by the
	 * other workers. The queue hands one to each worker as its `onProgress`.
	 */
	createProgressSink({ ticket }: { ticket: TicketSummary }): (message: string) => void {
		return (message: string) => this.write({ line: `${ticket.identifier} · ${message}` });
	}

	/** Close the readline interface. Called once, on the way out of the command. */
	close(): void {
		this.terminal.close();
	}

	/** Print the question and read one typed line, re-prompting on a blank answer. */
	private async putQuestion({ question, ticket }: { question: string; ticket: TicketSummary }) {
		if (this.ended) {
			throw new Error(noTerminalMessage);
		}

		this.prompting = true;

		const abandoned = new Promise<never>((_resolve, reject) => {
			this.abandonPrompt = reject;
		});

		try {
			this.output.write(`\n${ticket.identifier} ${ticket.title}\n${question}\n`);

			for (;;) {
				// An accidental enter must not send a blank answer to a worker that
				// will act on it, so an empty line asks again. A closed input does
				// not: there is nobody there to type a second time.
				const typed = await Promise.race([this.terminal.question('answer: '), abandoned]);

				if (typed.trim() !== '') {
					return typed.trim();
				}
			}
		} finally {
			this.abandonPrompt = undefined;
			this.prompting = false;
			this.flush();
		}
	}

	/** One line out, or held until the open question has been answered. */
	private write({ line }: { line: string }) {
		if (this.prompting) {
			this.held.push(line);

			return;
		}

		this.output.write(`${line}\n`);
	}

	private flush() {
		const held = this.held;

		this.held = [];

		for (const line of held) {
			this.output.write(`${line}\n`);
		}
	}
}
