# The transactions topic

How a key-value store whose server can only change one doc at a time
gets ACID transactions across many docs. The transaction runs in the
client (here, gocbcore, the core of Couchbase's Go SDK), with ordinary
single-doc reads and writes: each change is staged in an xattr beside
the doc it changes, and one small record, the ATR (active transaction
record), written once, decides whether all of them happened.

- `01-life/`: the life of one transaction, alice pays bob 30: the two
  reads; the ATR's entry, PENDING; each new value staged in its doc's
  "txn" xattr; the ATR's flip to COMMITTED, the commit point; each doc
  unstaged; and the ATR's entry deleted. Each request travels from a
  line of the app's code to the one doc it reads or writes. (Draft.)
- `lib/`: the transaction, run for real (`lib/tools/txn-golden`, `npm
  run golden -- transactions`): gocbcore, at the version in
  `sources.yaml`, runs it against CAVES, Couchbase's mock server, and
  at each of gocbcore's test hooks the tool snapshots each doc's body
  and "txn" xattr, and the ATR's "attempts" xattr, into `txn.json`.
  UUIDs and CASes are renamed in order of appearance (txn-1,
  attempt-1, cas-1, ...), so the output is the same every run. The
  mock's binary is downloaded once, from gocaves' GitHub releases,
  into the repo's `tmp/` (not committed). `txn.js` reads `txn.json`
  for the pages.

## Color and icon rules

| Mark | Means |
|---|---|
| red ball | a request in flight, from the app's line of code to the one doc it reads or writes |
| amber | staged: a new value in a doc's "txn" xattr, where only transactions look; the ATR's PENDING; a doc's pointer to the ATR |
| blue | the ATR, and the commit point |
| green | done: the ATR's COMMITTED, and an unstaged doc's station |
| a dashed box | an xattr, beside the doc's body |
| struck-through grey | what was there before (`was 100`, a deleted ATR entry) |
