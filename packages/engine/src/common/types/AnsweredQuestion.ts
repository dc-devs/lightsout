/**
 * A question a worker stopped on, paired with the answer it was given.
 *
 * Threaded verbatim from the queue's relay loop through the direct run into
 * both invocation builders, so every leg of that path names one shape.
 */
export interface AnsweredQuestion {
	question: string;
	answer: string;
}
