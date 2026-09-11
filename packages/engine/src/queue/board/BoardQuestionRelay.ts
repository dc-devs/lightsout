import type { QueueBoardRecorder } from '#src/queue/board/QueueBoardRecorder.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

interface ConstructorParams {
	/** The relay the CLI built — terminal or mailbox. Delivery, timing and answers stay its own. */
	relay: QuestionRelay;
	board: QueueBoardRecorder;
}

/**
 * The relay the queue hands its workers: the CLI's own relay, observed so the
 * board shows a ticket waiting for an answer while its question is open.
 *
 * It holds the CLI's relay rather than replacing it, so every call reaches that
 * relay unchanged and the question travels exactly as it would without a board.
 */
export class BoardQuestionRelay implements QuestionRelay {
	private readonly relay: QuestionRelay;
	private readonly board: QueueBoardRecorder;

	constructor({ relay, board }: ConstructorParams) {
		this.relay = relay;
		this.board = board;
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
		this.board.markWaiting({ ticket, question });

		try {
			return await this.relay.ask({ question, ticket, coordinatorRunId, coordinatorRunDir });
		} finally {
			this.board.clearWaiting({ ticket });
		}
	}

	createProgressSink({ ticket }: { ticket: TicketSummary }): (message: string) => void {
		return this.relay.createProgressSink({ ticket });
	}

	close(): void {
		this.relay.close();
	}
}
