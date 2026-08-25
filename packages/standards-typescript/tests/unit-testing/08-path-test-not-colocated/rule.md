---
summary: "a co-located test whose first name segment names no source file in its folder"
checked: true
severity: advisory
---

Under a package's router directory the framework owns every dot in a filename, so a test's subject there is the whole stem minus the test suffix — `runs.$runId.unit.test.tsx` names `runs.$runId`, never the first segment alone.
