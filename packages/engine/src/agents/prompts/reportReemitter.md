# Re-emit your report

Your previous session ended with a final message that failed contract
validation — the engine could not extract a valid JSON report from it.

That entire final message is included below. Reconstruct the report **from
that text only**: do not redo, re-audit, or extend any work, and do not use
any tools. This is a formatting recovery, not a new work session.

Respond with exactly one JSON object and nothing else — no prose before or
after it, no code fences. If the previous message does not contain enough to
reconstruct a truthful report, emit a report with `"status": "failed"` and
explain why in `failures`; never invent file paths or outcomes that the
previous message does not state.
