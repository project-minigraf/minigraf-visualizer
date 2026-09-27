# Test fixtures

`native-v2.0.2.graph` was written by the native Minigraf 2.0.2 REPL
(`cargo run --release -- --file native-v2.0.2.graph`) with this input:

```
(transact {:valid-from "2020-01-01" :valid-to "2023-06-01"} [[:alice :works-at :techcorp]])
(transact {:valid-from "2023-06-01"} [[:alice :works-at :startupco]])
(transact [[:alice :person/name "Alice"]])
(retract [[:alice :works-at :startupco]])
EXIT
```

The REPL checkpoints on exit, so there is no `.wal` sidecar. The test checks
that the browser engine opens the file and that the rebuilt history matches.
