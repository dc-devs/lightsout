import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * How a worker's question reaches whoever can answer it.
 *
 * Two implementations: `TerminalQuestionRelay` reads a typed line from the
 * terminal that started the drain, `FileQuestionRelay` writes the question to a
 * mailbox directory and waits for an answer file. The queue types against this
 * interface alone, so which one is in play is a decision the CLI makes once and
 * nothing downstream re-asks.
 */
export interface QuestionRelay {
	/**
	 * Put one worker's question to whoever can answer it.
	 *
	 * The answer is on disk and on the ticket before this resolves, so a worker
	 * never acts on a decision nothing recorded.
	 *
	 * @throws {Error} When the question can never be answered — no terminal, a
	 * closed relay, or an elapsed question timeout. The caller parks the ticket.
	 */
	ask(params: { question: string; ticket: TicketSummary; coordinatorRunId: string; coordinatorRunDir: string }): Promise<string>;

	/** This ticket's progress writer, handed to its worker as `onProgress`. */
	createProgressSink(params: { ticket: TicketSummary }): (message: string) => void;

	/** Release whatever the relay holds. Called once, on the way out of the command. */
	close(): void;
}
