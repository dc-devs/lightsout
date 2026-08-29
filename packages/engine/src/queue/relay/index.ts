// `recordRelayedAnswer` stays off this barrel: it is how both relays keep the
// promise that an answer is on disk and on the ticket before a worker sees it,
// and a caller reaching it directly could record without asking.
export { emptyRelayMailbox } from '#src/queue/relay/emptyRelayMailbox.ts';
export { FileQuestionRelay } from '#src/queue/relay/FileQuestionRelay.ts';
export { TerminalQuestionRelay } from '#src/queue/relay/TerminalQuestionRelay.ts';
