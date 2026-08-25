# @lightsout/standards-testkit

Builds the input a standards check receives, in memory, so a rule's own unit
tests can prove it catches what it claims.

```ts
import { setupSyntaxTreeInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

test('flags a file over the line cap', () => {
	const input = setupSyntaxTreeInput({ sources: [['src/big.ts', tooManyLines]] });

	expect(check.run({ input, settings: { file: 250 } })).toHaveLength(1);
});

test('ignores an input of a kind it did not ask for', () => {
	expect(check.run({ input: setupOtherKindInput(), settings: {} })).toStrictEqual([]);
});
```

One factory per input kind, plus `setupOtherKindInput` for the guard every check
opens with. Each takes what you actually have — the files and their text — works
out the rest, and lets you override any field.

## What this is not

It does not read a repo off disk. The engine has its own builders for that, and
they stay in the engine: they open files, resolve a dependency graph and run a
duplicate-block detector, none of which a rule's unit test wants. Both sides build the same
shape because the shape is declared once, in
[`@lightsout/standards-contracts`](../standards-contracts).

It also does not run a rule against its `fixtures/pass` and `fixtures/fail`
folders. That is a whole-pack question rather than a single-rule one, and it
already ships as a command:

```
lightsout standards-validate --pack <path to your pack>
```

Every rule is run against both sides of its own example pair, and a rule whose
fail fixture produces no finding is reported as a problem. Run it while writing a
rule; it is the gate that says the check does what the prose promises.
