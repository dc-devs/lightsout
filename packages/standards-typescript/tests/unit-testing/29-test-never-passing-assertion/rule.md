---
summary: "an assertion written so that it can never pass — `expect.objectContaining` pairing a key with `undefined`"
checked: true
severity: blocking
---

### Assertions That Can Never Pass

An assertion that no implementation can satisfy is found by a failed run, and whoever reads the red test has to prove by hand that the test, not the code, is wrong. Write each assertion in a form whose meaning matches how it reads.

- **`expect.objectContaining` never takes an `undefined` value.** It reads as "the object has these values", so `expect.objectContaining({ ticketRef: undefined })` reads as "and `ticketRef` is absent" — but the matcher first requires every key it names to be present. An object without the key never matches, and an object read back from disk never has it: `JSON.stringify` drops a key holding `undefined`. Say what you mean instead:
  - the key is absent — drop it from the matcher and compare `Object.hasOwn(value, 'ticketRef')` against `false`;
  - the value is undefined, whether or not the key exists — assert `value.ticketRef` with `toBe(undefined)`.

```typescript
// ❌ never passes against a record read from disk — the key is not there to compare
expect(readRecord({ cwd, name })).toEqual(expect.objectContaining({ name, ticketRef: undefined }));

// ✅ states absence in a form that can pass
const record = readRecord({ cwd, name });

expect({ name: record.name, carriesTicketRef: Object.hasOwn(record, 'ticketRef') }).toStrictEqual({ name, carriesTicketRef: false });
```
