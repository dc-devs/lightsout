/**
 * The four files that sit beside a ticket's plan subfolders in the primary
 * checkout: the record itself, the sidecar naming the bytes last published or
 * restored, the published copy surfaced when the two have both moved, and the
 * exclusive lock every write to the record is taken under.
 *
 * One named object because they are one concept — a ticket's own files — and a
 * caller that knows one of the names knows where the others are.
 */
export const ticketFileNames = {
	record: 'ticket.json',
	sync: 'ticket-sync.json',
	published: 'ticket.published.json',
	lock: 'ticket.lock',
} as const;
