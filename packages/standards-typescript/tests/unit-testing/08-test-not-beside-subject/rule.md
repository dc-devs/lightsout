---
summary: "a test file whose folder holds no source file it could be testing"
checked: true
severity: advisory
---

Under a package's router directory the framework owns every dot in a filename, so a test's subject there is the whole stem minus the test suffix — `runs.$runId.unit.test.tsx` names `runs.$runId`, never the first segment alone.
