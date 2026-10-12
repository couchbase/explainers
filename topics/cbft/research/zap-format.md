# Zap segment format (v17): layout on disk, access at query time

Research notes for the second explainer. Versions pinned to what cbft
master uses (see `topics/cbft/sources.yaml`):

- zapx/v17 `v17.2.2-0.20260806075952-6594f3d6bd0d` (`Version = 17`, `build.go:28`)
- bleve `v2.6.1-0.20260807085028-9d2da23a5c58` (`index/scorch/...`)
- vellum `v1.2.0`, roaring/v2 `v2.14.5` (from zapx `go.mod`)
- scorch_segment_api/v2 `v2.4.9-0.20260729090843-4313bda09bee`

Unprefixed paths are zapx. Line numbers will rot; symbols won't.
zapx ships its own `zap.md` diagram, but it differs from the code in a
few places (noted below). Trust the code.

**TL;DR**: a zap file is one immutable, mmapped byte slice. The
**footer** at the end points to the **stored-fields index** and the
**sections index**. The sections index points to per-field records,
one per section type: inverted text, faiss vector, synonym, geo-shape-v2.
For text, a field's record points to its **vellum FST**
(term -> postings offset). The postings offset points to a **roaring
bitmap** of doc numbers, plus **chunked uvarint** freq/norm and
location streams. Deletions are *not* in the file. They are a roaring
bitmap per segment in `root.bolt`, applied at query time as
`postings ANDNOT deleted`.

## 1. File layout, front to back

Written by `interim.convert()` (`new.go:188-277`) for a new batch, and
by `mergeToWriter()` (`merge.go:173-238`) for merges:

1. **Stored fields data**: one record per doc, in docNum order (`new.go:354-433`).
2. **Stored fields index**: `numDocs` × uint64 BE offsets (`new.go:435-442`).
3. **Nested-doc edge list**: uvarint count, then (child, parent)
   uvarint pairs (`new.go:444-467`). It's new in v17 for nested docs,
   and normally the count is 0.
4. **Section bodies**: each registered section persists all its
   fields (`new.go:254-259`). The section IDs are
   `SectionInvertedTextIndex=0, SectionFaissVectorIndex=1, SectionSynonymIndex=2,
   SectionGeoShapeV2Index=3` (`section.go:58-68`).
   **Surprise:** `segmentSections` is a Go `map[uint16]section`
   (`section.go:72-77`). So the *physical order* of section bodies in
   the file follows map iteration order and is not fixed. Readers only
   follow offsets, so the order doesn't matter. zap.md's
   text → vector → synonym ordering is idealized.
5. **Sections info**: one record per field (`write.go:64-101`):
   - uvarint name length, then the name;
   - uvarint `FieldIndexingOptions`;
   - uvarint `NS` (number of sections, always all registered sections);
   - `NS` × (uint16 BE section type, uint64 BE address). An address of
     0 means the field has no data in that section.
6. **Sections index**: uvarint `NF`, then `NF` × uint64 BE offsets
   into the sections info (`write.go:103-115`). The sections-index
   offset points at the `NF` varint. (zap.md draws `NF` *after* the
   offsets, but the code writes it first.)
7. **Footer** (`write.go:120-178`). All big-endian, in this order:

| field | size |
|---|---|
| file-writer ID (callback ID; empty unless a WriterHook such as encryption is set) | `idLen` bytes |
| `idLen` | uint32 |
| `numDocs` | uint64 |
| `storedIndexOffset` | uint64 |
| `sectionsIndexOffset` | uint64 |
| `chunkMode` (default 1026, `chunk.go:28`) | uint32 |
| `Version` (=17) | uint32 |
| CRC32 (IEEE) of everything before this field | uint32 |

`FooterSize = 36` excluding the ID (`write.go:123`).

Field IDs: `_id` is always field 0, and the rest are sorted by name
(`new.go:196,216`). Doc numbers are batch positions after flattening
nested docs (`new.go:71`). They are *not* sorted by `_id`.

**Opening** (`segment.go:52-110`): `os.Open` + `mmap.Map(RDONLY)`.
Then:

- `loadConfig()` reads the footer backwards from `len(mm)`
  (`segment.go:243-294`). It rejects any `version != 17`, and the CRC is
  read but **not verified** here. `mem` becomes `mm[:len-footerSize]`.
- `loadFields()` walks the sections index, building `fieldsInv`,
  `fieldsMap` (name -> id+1) and `fieldsSectionsMap[fieldID][section]`
  (`segment.go:335-426`).
- `loadDvReaders()` reads only each field's doc-value chunk-offset
  table (`segment.go:818-858`).

No dictionaries or postings are touched at open. Bleve picks the zapx
major version per segment from the plugin registry
(`bleve index/scorch/segment_plugin.go:83-91`, v11-v17). New segments
are always v17.

In-memory segments (`SegmentBase`) are this exact byte layout in a
`bytes.Buffer`, minus the footer (`new.go:75-83`, `InitSegmentBase`
`build.go:187-240`). Persisting writes `mem` and then appends the footer
(`build.go:120-140`).

**Older versions, briefly:**

- v15 had no sections. Its footer had separate fields-index and
  docValue offsets (`v15 write.go:86-88`).
- v16 introduced sections. Its footer kept docValueOffset and
  fieldsIndexOffset alongside sectionsIndexOffset
  (`v16 write.go:106-108`).
- v17 drops those and adds the writer ID + `idLen`.

## 2. Term lookup, end to end (one field)

1. `fieldsMap[field]` gives `fieldID+1`, and
   `fieldsSectionsMap[id][SectionInvertedTextIndex]` gives the
   field-record address (`segment.go:437-442`).
2. The **field record** is three uvarints: `dvStart`, `dvEnd`,
   `dictOffset` (`section_inverted_text_index.go:675-695`). The
   dictionary code skips the first two (`segment.go:449-455`).
3. At `dictOffset` there is a uvarint length, then the vellum bytes
   (`section_inverted_text_index.go:600-618`). `vellum.Load` runs on
   the mmapped slice (zero-copy unless a file callback transforms it).
   The result is cached per fieldID in `invIndexCache`
   (`inverted_text_cache.go:48-88`), so it's loaded once per segment
   lifetime.
4. `Dictionary.postingsList` calls `fstReader.Get(term)` to get a
   uint64 value (`dict.go:59-80`).
5. The top two bits of the value select the encoding (`posting.go:43-90`):
   - `00`: general. The low 62 bits are the postings offset.
   - `10`: **1-hit**. Bits 31-61 are the 31-bit norm bits and bits 0-30
     the docNum (`FSTValEncode1Hit`, `posting.go:78-84`). There is no
     postings record at all.

   1-hit applies when cardinality is 1, there are no locations, the
   freq is 1 and the docNum is under 2^31 (`section_inverted_text_index.go:178-186`).
   **Surprise:** it is only produced by **merge**. Fresh segments call
   `writePostings(..., nil /*use1Hit*/, ...)`
   (`section_inverted_text_index.go:579`). So `_id` terms get 1-hit only
   after their first merge.
6. The **postings record** at the offset is `uvarint freqOffset`,
   `uvarint locOffset`, `uvarint len`, then the roaring bytes
   (`merge.go:376-428`). The reader loads it with
   `roaring.FromBuffer`, a zero-copy view on mmap
   (`posting.go:271-317`). The freq and loc streams are written
   *before* this record, so their offsets point backwards.
   Within a field, the order is all terms' (freq, loc, postings),
   then the FST, then doc values, then the field record.
7. **Chunked int streams** (freq/norm and locs) (`intcoder.go:137-181`):
   - uvarint `numChunks`, then numChunks uvarint *cumulative end
     offsets*, then the concatenated chunk bytes. They are **not
     compressed**: they're plain uvarints.
   - Chunk = `docNum / chunkSize` (`intcoder.go:89-96`). Chunk size
     comes from `getChunkSize(chunkMode, cardinality, numDocs)`. In
     mode 1026 that is `numDocs / (cardinality/1024 + 1)`, which aims
     for ~1024 hits per chunk (`chunk.go:67-81`).
   - The offset 0 (`termNotEncoded`) means an empty stream
     (`intcoder.go:185-197`).
8. **Per-hit freq/norm**:
   - `uvarint(freq<<1 | hasLocs)` (`posting.go:457-469`), then, if
     freq>0, `uvarint(normBits)`.
   - **Surprise:** the "norm" bits are the *field length* as an
     integer, smuggled through `Float32frombits`
     (`section_inverted_text_index.go:712`, `:528`).
     `Posting.Norm()` computes `1/sqrt(Float32bits(norm))` at read time
     (`posting.go:894-896`).
9. **Per-hit locations**: a uvarint byte-count, then for each location
   `fieldID, pos, start, end, numArrayPos, arrayPos...`, all uvarints
   (`section_inverted_text_index.go:538-562`, `posting.go:473-522`).
10. **Iteration** (`posting.go:158-231`, `536-680`):
    - `Actual = postings ANDNOT except`, where `except` is the
      segment's deleted bitmap.
    - Iteration walks `Actual`. It keeps a second iterator over `all`
      to stay in step with the freq/norm stream, loading the chunk
      `n / chunkSize` (`loadChunk`, `intDecoder.go:76-105`) and skipping
      uvarints for docs it passes.
    - The clean case (no deletions) has a fast path
      (`posting.go:736-790`).

## 3. Stored fields

The stored fields for doc N are found like this (`read.go:19-52`):

1. Read the uint64 at `storedIndexOffset + 8*N`.
2. The record there is `uvarint metaLen, uvarint dataLen, meta, data`.

Inside a record (`new.go:337-433`, `build.go:142-185`):

- `meta` is uvarints: `len(_id)`, then per stored value
  `fieldID, type, offset, length, numArrayPos, arrayPos...`. It is
  *not* compressed.
- `data` is the raw `_id` bytes followed by
  `snappy(concatenated values)`.
- **Compression is per doc**, so there is no multi-doc chunking. `_id`
  sits uncompressed in front, so `DocID(n)` never decompresses
  (`segment.go:617-641`).
- `VisitStoredFields` snappy-decodes the rest and slices values by
  meta (`segment.go:537-614`).

`_id` -> docNum goes the other way, through the `_id` field's
dictionary (`DocNumbers`, `segment.go:650-678`).

## 4. Doc values

The values are the field's **indexed terms**, uninverted from the
postings while writing (`docTermMap`,
`section_inverted_text_index.go:568-570`). They are not the original
values. For each doc, the terms are concatenated, each followed by `0xff`
(`index.DocValueTermSeparator`).

Encoding (`section_inverted_text_index.go:628-673`, `contentcoder.go`):

- Doc values always use the legacy chunk size 1024
  (`LegacyChunkMode`). Field options can override this:
  `SkipDVChunking` gives chunk=1 and `SkipDVCompression` turns off
  snappy.
- Each chunk is `uvarint numDocsInChunk`, then that many
  (docNum, endOffset) uvarint pairs, then `snappy(data)`
  (`contentcoder.go:144-184`).
- After the chunks come the uvarint per-chunk end offsets, then
  uint64 BE `chunkOffsetsLen` and uint64 BE `numChunks`
  (`contentcoder.go:219+`). The reader parses these from `dvEnd`
  backwards (`docvalues.go:111-157`).

Read path (`VisitDocValues`, `docvalues.go:336-402`):

1. chunk = `docNum/1024`.
2. `loadDvChunk` (`docvalues.go:167-225`).
3. The chunk is snappy-decoded once and kept in the per-query
   `docVisitState` (`docvalues.go:275-322`).
4. Binary-search the chunk header for docNum, then split on `0xff`.

Sorting and faceting call this through
`IndexSnapshot.DocValueReader` (bleve `search/collector/topn.go:320`,
`index/scorch/snapshot_index.go:881-903`). Fields *without* persisted
doc values fall back to an in-memory uninversion cache, `cachedDocs`,
built by walking the dictionary and postings (`snapshot_index.go:786-880`,
`snapshot_segment.go:283`).

## 5. Deletions

These are confirmed **not in the zap file**:

- `SegmentSnapshot.deleted *roaring.Bitmap`
  (bleve `index/scorch/snapshot_segment.go:37`).
- The introducer ORs in new obsoletes: `seg.DocNumbers(ids)` (via the
  `_id` FST) ∪ the old `deleted`, plus nested descendants
  (`introducer.go:137-171`).
- Persisted in **`root.bolt`** (`scorch.go:402`):
  `prepareBoltSnapshot` writes `deleted.WriteTo()` (roaring portable
  format). The bucket path is `'s'` (snapshots) / epoch / segmentID,
  and in that bucket `'p'` holds the zap filename and `'d'` the
  deleted bitmap (`persister.go:750-760`, `util/keys.go:19-24`).
- On load, the bitmap is read back next to `OpenUsing(path)`
  (`persister.go:1064-1096`).
- Zap filenames are `%012x.zap` (`persister.go:872`).
- Deleted docs disappear physically only when a merge drops them (§9).

## 6. Vellum FST, as used here

- It maps each **sorted term** (bytes) to a **uint64**: a postings
  offset or a 1-hit value. There's one FST per field per segment.
- **Compactness**:
  - Prefix sharing: `Insert` finds the common prefix with the
    previous key and only adds the suffix (`builder.go:91-112`).
  - Suffix sharing: frozen nodes are hashed into a `registry`, and
    identical nodes are reused (`builder.go:156-170`, `registry.go`).
  - Outputs are pushed toward the root using `min` / subtract / add
    algebra (`builder.go:399-412`), so a lookup *sums* the outputs
    along its path.
  - Postings offsets grow in term order, which keeps the per-edge
    outputs small.
- **Encoding**: a 16-byte header (version, type), then states. A
  state is written after its children, so the root is near the end. A
  16-byte LE footer holds `(count, rootAddr)`
  (`encoder_v1.go:49-61,211-215`, `decoder_v1.go:40-56`).
- **Lookup** (`fst.go:70-97`): start at the root. For each input byte,
  `TransitionFor(c)` and add that edge's output. At the end, require a
  final state and add `FinalOutput`.
- **Prefix / range**: `fst.Search(automaton, startInclusive,
  endExclusive)`.
  - Prefix becomes the range `[p, successor(p))`
    (`bleve snapshot_index.go:286-313`).
  - Regexp compiles to a vellum `regexp` DFA
    (`snapshot_index.go:316-344`).
  - Fuzzy uses a prebuilt Levenshtein DFA builder for distance 1 or 2
    (`snapshot_index.go:59-70,349-399`; vellum `levenshtein/`, a port
    of tantivy's parametric DFA).
- **Intersection** (`fst_iterator.go:205-245`): a depth-first walk
  that runs the automaton in lockstep. For each FST transition byte
  `t`, it computes `aut.Accept(state, t)` and prunes the whole subtree
  if `!CanMatch`. It emits a key when the FST state is final and
  `aut.IsMatch`. Fuzzy iterators also report `EditDistance`
  (`dict.go:189-191`).
- Across segments, bleve opens one dictionary iterator per segment,
  each in its own goroutine, and merges the terms with a heap
  (`snapshot_index.go:153-222`).

## 7. Roaring, as used here

- A uint32 is split into high 16 bits (container key) and low 16 bits
  (value in the container) (`util.go:114-120`).
- Container types:
  - **array**: sorted uint16, ≤4096 entries (`util.go:11`,
    `arraycontainer.go:8`);
  - **bitmap**: 1024 × uint64 = 8 KB (`bitmapcontainer.go:10`);
  - **run**: (start, length) pairs (`runcontainer.go:49`).
- zapx builds bitmaps with `Add` and never calls `RunOptimize`. So as
  far as I can tell, on-disk postings are array or bitmap containers
  in practice (not verified exhaustively).
- **Why it fits**:
  - Postings are sets of docNums.
  - `FromBuffer` reads straight from mmap with no deserialization
    (`roaring.go:362`).
  - Set operations run container by container, which is fast.
  - Doc numbers are dense within a segment.
- **Query-time ops**:
  - `AndNot(postings, deleted)` per term per segment (`posting.go:224`).
  - `And` across terms in conjunction optimizations (§8).
  - `Or` for unadorned disjunctions and `DocNumbers`
    (`roaring.go:1644,1691,1776`).

## 8. A query touching the structures

**Term query** (`bleve snapshot_index.go:625-700`), for each segment
in the snapshot:

1. `Dictionary(field)` locates the field record, then the cached FST
   (§2).
2. `PostingsList(term, s.deleted)` runs the FST `Get`, reads the
   postings header and runs roaring `FromBuffer`.
3. `Iterator(freq, norm, locs)` decodes the freq/loc chunk-offset
   tables and computes `Actual = postings ANDNOT deleted`.
4. `Next()` walks `Actual` and lazily loads one freq/norm chunk (and
   one loc chunk) at a time. These are plain uvarint reads from mmap.
   `Norm()` = `1/sqrt(fieldLen)`.
5. Global doc IDs are segment base offset + local docNum. `Advance`
   binary-searches `offsets` to jump to a segment
   (`snapshot_index.go:575-582`, `snapshot_index_tfr.go:156-200`).

The term-field reader's arrays (`dicts`, `postings`, `iterators`) are
reused through `allocTermFieldReaderDicts` / prealloc parameters.
Per-segment caches hold the FST per field, doc-value chunk-offset
tables (at open), and `cachedDocs` for uninverted fields.

**Match query**: analysis produces terms, which become a
disjunction/conjunction of term searchers. The same reads as above
happen per term.

**Conjunction** (`search/searcher/search_conjunction.go:58-84`):

- If `Score=="none"` and term vectors aren't needed, the
  **unadorned** optimization ANDs the `Actual` bitmaps per segment
  (1-hit postings handled specially) into a single bitmap iterator
  (`index/scorch/optimize.go:158-260`).
- Otherwise the "conjunction" optimization still runs
  `roaring.And` of all children's `Actual` bitmaps per segment and
  `ReplaceActual`s them. The normal leapfrog `Advance()` searcher then
  walks a smaller bitmap but still reads freq/norm for scoring
  (`optimize.go:77-120`).
- So visually: `(A ANDNOT del) AND (B ANDNOT del)`, per segment.

Stored fields are read only for hits being returned, and doc values
only for sort/facet fields of candidate hits.

## 9. Merge writes a new file

`mergeSegmentBases` (`merge.go:68-126`) writes through a 1 MB bufio
writer with a CRC-counting writer, then the footer, then `fsync`.

1. `mergeFields`: the union of fields. `fieldsSame` enables
   byte-copy fast paths (`merge.go:179-190`).
2. `numDocs = Σ(numDocs - |drops|)` (`merge.go:252-261`).
3. **Renumbering**: `mergeStoredAndRemap` walks segments in order,
   assigning new docNums sequentially. Dropped docs get
   `docDropped = MaxUint64` (`merge.go:34,506-513`). The result is
   `newDocNums[seg][oldDocNum]`, which is also returned to scorch.
   - Stored docs are re-encoded (`merge.go:527-624`).
   - When a segment has no drops and no file callbacks, the stored
     bytes are copied wholesale (`merge.go:490-503`).
   - The edge list is remapped (`merge.go:641-693`).
4. Each section's `Merge()` runs in map order (`merge.go:220-228`).
   For text (`section_inverted_text_index.go:81-417`), per field:
   - a k-way merge of every segment's FST iterator (`enumerator.go:39`)
     yields terms in sorted order;
   - for each term, each source's postings are read **with `drops`
     as `except`**, so deleted docs never surface;
   - each hit's docNum is remapped and added to a new roaring bitmap,
     and its freq/norm/loc bytes are re-encoded (or byte-copied when
     `fieldsSame` and there are no callbacks, `merge.go:263-298`);
   - per-term chunk sizes are recomputed from the new cardinality
     (`:236-254`);
   - 1-hit encoding is applied here (`:178-186`);
   - a fresh FST is built, and doc values are re-chunked through the
     remap (`:338-366`).
5. Then the new sections index and footer are written.

The merged segment is introduced with `deleted = nil`, plus any docs
deleted *during* the merge, remapped through `newDocNums`
(`introducer.go:366-451`).

## Visualizable moments (one change at a time)

1. A zap file as one long bar. The mmap "lights up" all of it at once,
   but nothing is read yet.
2. The reader jumps to the **end**. The footer's fields peel off right
   to left: CRC, version 17, chunk mode, the two offsets, numDocs,
   idLen, writer ID.
3. Arrows from the footer: `sectionsIndexOffset` jumps back to the
   sections index, then fans out to per-field records (`_id`, `body`,
   `title`…), each with 4 section slots, some 0.
4. Picking `body`: its record's three uvarints (dvStart, dvEnd,
   dictOffset). Follow `dictOffset` to the FST blob.
5. The FST for terms `{quick, quiet, quilt, run, ran}`. Shared prefix
   `qui-` collapses, then a shared suffix collapses. One change per
   step.
6. The FST walk for `quick`: byte-by-byte transitions, with outputs
   summing into the postings offset.
7. The 64-bit value split: top bits `00` gives an offset (arrow back),
   versus `10` giving a 1-hit with docNum and fieldLen packed inline
   (no arrow).
8. Following the offset: the postings header (freqOffset, locOffset,
   len). The roaring bitmap appears; the freq/loc streams sit *before*
   it.
9. Inside the roaring bitmap: docNum 70,000 splits into
   high=1 / low=4464, giving container 1. Array vs bitmap container by
   density.
10. The deleted bitmap arrives from `root.bolt` (not the zap file).
    `postings ANDNOT deleted` fades out the dead docs.
11. The chunked freq/norm stream: docNums bucketed into chunks.
    Iterating to doc 3,100 loads only chunk 3. Decode `freq<<1|hasLocs`
    and the fieldLen, then `1/sqrt(fieldLen)`.
12. Conjunction `quick AND fox`: two bitmaps, each minus deleted, then
    ANDed per segment into the survivors.
13. Fetching a hit's stored fields: `storedIndex[N]`, the record with
    the uncompressed `_id` up front, and the snappy blob decompressed
    only if needed.
14. Sort by `date`: doc-value chunk `N/1024`, snappy-decoded once, a
    binary search of the chunk header, split on `0xff`.
15. Fuzzy `quikc~1`: the Levenshtein DFA and the FST walked together.
    Whole subtrees are pruned when `CanMatch` fails, and the surviving
    terms light up.
16. Merge: two segments' FST iterators zipper into one sorted stream,
    deleted docs drop out, and survivors are renumbered 0..n-1 into a
    new file with a new footer.
