# The rebalance topic

Where a Couchbase bucket's vbuckets live, and how they move when the
cluster changes.

- `01-vbmap/`: how ns_server's vbmap tool lays out vbuckets: told as a
  story about one document's vbucket, from a naive layout's failures
  to vbmap's rules, its flow graphs and a rebalance. (Draft.)
- `lib/`: the vbucket maps the explainers show, made by the real vbmap
  binary (`lib/tools/vbmap-golden`, `npm run golden -- rebalance`).

## Color and icon rules

One set of marks, used the same way in every scene:

| Mark | Means |
|---|---|
| rounded rect | one copy of a vbucket |
| filled, with a small A | the active copy (serves reads and writes) |
| thick outline, lower-right half filled, a small R | a replica |
| filled, with a thin dark outline | a replica promoted to active, after a failure |
| a node's color | the vbucket's home: the node with its active copy (so a replica shows whose vbucket it backs up) |
| the bin it's in | the node that holds that copy |
| slate | a copy not yet on any node |
| a grey curtain | a node (or a whole rack) that's down; the copies on it sit on top, in their colors, unreachable |
| red | danger only: a vbucket lost (a red × on its copies), a node serving far more than its share, or a copy that must move |
| a ring | the story's vbucket (vbucket 9, from the document airline_10) |
| tinted box | a rack: blue-grey for East, sand for West |

Node colors: rack East's nodes take cool hues (a teal, b blue, e
green), rack West's warm ones (c orange, d magenta, f brown), each far
from the others, in light and dark.

## Motion rules

- The same marks stay on screen throughout; they move, never appear
  from nothing.
- Between two of the diagram's states, one thing changes: where the
  marks are, which nodes are down, which copies are grey, which are
  promoted, and so on. A test checks this
  (`01-vbmap/test/states.test.mjs`).
- When many marks change, they change one after another, in reading
  order, not all at once. A failure is the exception: a curtain drops
  over everything that's down at once, as fast as a failure is.
