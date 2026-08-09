---
summary: "a `let` reassigned in a beforeEach — mutable state shared across tests"
checked: true
severity: blocking
---

- **Arrange in a `setup()` factory.** The factory wires mocks and builds fixtures, then returns the locals the test needs as `const`s. Do **not** hold the subject under test in a shared `let` reassigned across `beforeEach` blocks — that is mutable test state.
- **Act and assert live in the `test`**, not in `beforeEach`. (Component tests are the one accepted exception: `render()` lives in the `setup()` factory by convention — see the component testing doc.)
- **One `setup()` and one act per test.** Two setups or two acts means two tests. Multiple `expect`s are fine only when they assert one behavior's result.
- **No nested method calls in the act.** Assign each call's result to a named `const`. Two exceptions: (1) the error case, where the act sits inside the matcher: `expect(() => parse(bad)).toThrow()`; (2) assertion-matcher composition (`toEqual(expect.objectContaining(...))`).
- **Blank line between arrange, act, and assert** — and no `// arrange` / `// act` / `// assert` captions; the spacing already shows the structure.
- **Test behavior, not internals.** Assert the observable output a consumer sees. (Asserting an injected repository was called with the right args IS behavior — the persistence call is the unit's observable side effect at its boundary.)
- When asserting multiple properties of one result, prefer a single `expect`. For a **partial** match use `toEqual(expect.objectContaining({ ... }))` — not `toStrictEqual`: with an asymmetric matcher argument, Jest only runs the matcher and the strict extra-property checks never fire, so `toStrictEqual` there is identical to `toEqual` but misleadingly implies strictness. Reserve `toStrictEqual` for whole-object assertions with a concrete expected object.
- Cover all code paths — branches, error handling, boundary conditions. Each test exercises a unique code path; don't add tests that only vary input without varying behavior.
- **Reaching defensive branches:** when a branch guards against input the type system forbids (a `default` arm, an early return on an impossible discriminant), a test may force the invalid input with `as unknown as T` — the one blessed double cast, and it lives only in test files, never in source.
- Use `test.each` when multiple inputs exercise the **same code path** with different outputs; different code paths get separate tests.
