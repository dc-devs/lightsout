/**
 * What both ways into ship say when `ship.ticket-pattern` cannot do its job.
 *
 * `lightsout ship` and `implement --ship` refuse the same configuration for the
 * same reason, and a user who hits it one way and then the other must not be
 * told two different things about one key.
 */
export const unusableTicketPatternMessage = 'ship: `ship.ticket-pattern` must be a valid regular expression carrying a `ticket` named group';
