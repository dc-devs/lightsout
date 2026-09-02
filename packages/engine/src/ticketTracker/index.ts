// `runLinear` is deliberately absent: it is the one place a client is built,
// and publishing it would let a caller reach past this barrel and talk to the
// tracker directly — exactly what keeps `runGh` out of the forge's barrel.
export { appendTicketNote } from '#src/ticketTracker/appendTicketNote.ts';
export type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
export type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
export type { JiraTrackerSettings, LinearTrackerSettings, TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
export type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
export { getTicketAttachments } from '#src/ticketTracker/getTicketAttachments.ts';
export { getTicketsByIdentifiers } from '#src/ticketTracker/getTicketsByIdentifiers.ts';
export { listTickets } from '#src/ticketTracker/listTickets.ts';
export { readTicketAsset } from '#src/ticketTracker/readTicketAsset.ts';
export { resolveTrackerSettings } from '#src/ticketTracker/resolveTrackerSettings.ts';
export { setParkedLabel } from '#src/ticketTracker/setParkedLabel.ts';
export { setTicketAttachment } from '#src/ticketTracker/setTicketAttachment.ts';
export { setTicketStatus } from '#src/ticketTracker/setTicketStatus.ts';
