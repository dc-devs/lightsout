import { QueueBoardState } from '#src/cli/common/constants/QueueBoardState.ts';
import { queueUpdateIntervalMs } from '#src/cli/common/constants/queueUpdateIntervalMs.ts';
import { formatTicketLink } from '#src/cli/common/queueBoard/formatTicketLink.ts';
import { toInlineMarkdown } from '#src/cli/common/queueBoard/toInlineMarkdown.ts';
import { type QueueBoardTicket, QueueLane } from '#src/contracts/index.ts';

/**
 * Each column's header. Keyed by `QueueLane` rather than by `string`, so a lane
 * added to the board fails the typecheck here instead of drawing a blank header.
 */
const laneLabels: Record<QueueLane, string> = {
	[QueueLane.BuildQueue]: 'Build Queue',
	[QueueLane.Building]: 'Building',
	[QueueLane.ShipQueue]: 'Ship Queue',
	[QueueLane.ShippingNow]: 'Shipping Now',
	[QueueLane.Shipped]: 'Shipped',
	[QueueLane.Parked]: 'Parked',
	[QueueLane.Blocked]: 'Blocked',
};

/** The lanes whose cells carry a reason: why a ticket stopped or is held, or a shipped ticket's stale tracker. */
const lanesWithReason = new Set<QueueLane>([QueueLane.Shipped, QueueLane.Parked, QueueLane.Blocked]);

/** Local 24-hour HH:MM, with no date and no zone — the clock a reader compares against the one on their own screen. */
const toClock = ({ at }: { at: Date }) => `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

const toHeading = ({ state, at }: { state: QueueBoardState; at: Date }) => {
	const time = toClock({ at });
	let heading = `Queue finished · ${time}`;

	if (state === QueueBoardState.Live) {
		heading = `Queue update · ${time} · next update ${toClock({ at: new Date(at.getTime() + queueUpdateIntervalMs) })}`;
	} else if (state === QueueBoardState.Stopped) {
		heading = `Queue stopped · last update ${time}`;
	}

	return heading;
};

const toCell = ({ ticket }: { ticket: QueueBoardTicket }) => {
	const label = formatTicketLink({ ticket });
	// Clipped so one long error cannot stretch the table; the queue's own report keeps the full text.
	const maxReasonLength = 120;

	return ticket.reason !== undefined && lanesWithReason.has(ticket.lane)
		? `${label} — ${toInlineMarkdown({ text: ticket.reason, maxLength: maxReasonLength })}`
		: label;
};

const toRow = ({ cells }: { cells: string[] }) => `| ${cells.join(' | ')} |`;

interface Params {
	tickets: QueueBoardTicket[];
	state: QueueBoardState;
	/** The time the heading shows: the render time on a live board, the last update or the finish otherwise. */
	at: Date;
}

/**
 * The queue's board as markdown lines: a heading, a blank line, then a table
 * with one column per lane in `QueueLane` order, where row N holds each lane's
 * Nth ticket in input order. An empty lane keeps its column, with an em dash in
 * its first row, so a ticket visibly moves across columns from one post to the
 * next.
 *
 * Pure — no clock and no terminal paint: the lines are markdown the queue
 * skill posts into a conversation.
 */
export const renderQueueBoard = ({ tickets, state, at }: Params): string[] => {
	const lanes = Object.values(QueueLane);
	const header = toRow({ cells: lanes.map((lane) => laneLabels[lane]) });
	const separator = toRow({ cells: lanes.map(() => '---') });
	const columns = lanes.map((lane) => tickets.filter((ticket) => ticket.lane === lane).map((ticket) => toCell({ ticket })));
	const depth = Math.max(1, ...columns.map((cells) => cells.length));
	const body = Array.from({ length: depth }, (_, row) => toRow({ cells: columns.map((cells) => cells[row] ?? (row === 0 ? '—' : '')) }));

	return [toHeading({ state, at }), '', header, separator, ...body];
};
