// `dedupeTickets` stays off this barrel: a wave's tickets are deduped as part of
// selecting them, and a caller deduping a list the selection never saw would
// drop the ambiguity skip that runs beside it.
export { listEligibleTickets } from '#src/queue/ticketSelection/listEligibleTickets.ts';
export { listNextWave } from '#src/queue/ticketSelection/listNextWave.ts';
export { orderTickets } from '#src/queue/ticketSelection/orderTickets.ts';
export { reconcileMergedTickets } from '#src/queue/ticketSelection/reconcileMergedTickets.ts';
export { selectWaveTickets } from '#src/queue/ticketSelection/selectWaveTickets.ts';
