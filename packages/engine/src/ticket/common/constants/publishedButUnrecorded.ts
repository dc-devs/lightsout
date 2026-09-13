/**
 * What every path that published the ticket record but could not write the
 * sidecar says, before the reason is appended.
 *
 * One spelling, because the three commands that can leave this state —
 * a record change, a catch-up sync and keeping the local copy — leave the human
 * in exactly the same position: the ticket has the new record, this machine has
 * forgotten it sent it, and the next sync will offer to send it again.
 */
export const publishedButUnrecorded = 'the ticket record was published, but this machine could not record that it was';
