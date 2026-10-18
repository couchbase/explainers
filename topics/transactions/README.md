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
- `02-during/`: what others see, and do, while a transaction is in
  flight. 01's transfer, T1, is paused by a test hook. An auditor
  reads alice and bob at three moments, plainly and in a transaction:
  plain reads see the transfer half done (a total of 120); the
  transaction's reads follow each staged doc's pointer to the ATR and
  always add up. Then, in a fresh run, T2 (bob pays alice 5) waits on
  T1's ATR entry (a write-write conflict), fails its CAS once T1 has
  changed bob, rolls back and retries. (Draft.)
- `lib/`: the transactions, run for real (`lib/tools/txn-golden`, `npm
  run golden -- transactions`): gocbcore, at the version in
  `sources.yaml`, runs them against CAVES, Couchbase's mock server,
  each scenario on a fresh cluster (01's transfer; 02's reads; 02's
  conflict), and at gocbcore's test hooks the tool snapshots each
  doc's body, CAS and "txn" xattr, and the ATRs' "attempts" xattrs,
  into `txn.json`. Hooks also pause one transaction while another
  runs.
  UUIDs and CASes are renamed in order of appearance (txn-1,
  attempt-1, cas-1, ...), so the output is the same every run. The
  mock's binary is downloaded once, from gocaves' GitHub releases,
  into the repo's `tmp/` (not committed). `txn.js` (01) and
  `during.js` (02) read `txn.json` for the pages.

## Color and icon rules

| Mark | Means |
|---|---|
| red ball | a request in flight, from the app's line of code to the one doc it reads or writes |
| violet ball | 02: the other client's request (the auditor's, or T2's); a dashed violet ring, T2 waiting on another's ATR entry |
| rose | an attempt ABORTED, and a write the server refused (✕) |
| amber | staged: a new value in a doc's "txn" xattr, where only transactions look; the ATR's PENDING; a doc's pointer to the ATR |
| blue | the ATR, and the commit point |
| green | done: the ATR's COMMITTED, and an unstaged doc's station |
| a dashed box | an xattr, beside the doc's body |
| struck-through grey | what was there before (`was 100`, a deleted ATR entry) |
