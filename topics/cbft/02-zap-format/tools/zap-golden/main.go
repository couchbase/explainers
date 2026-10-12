// Builds the zap explainer's example segment with the real zapx code
// (the version cbft uses), then reads the file back byte by byte, the
// way zapx does, and writes a JSON description of it: the regions,
// the footer, the sections index and field records, each field's
// vellum FST, each term's postings and freq/norm hits, and the stored
// fields. The page draws from that JSON, so the offsets, FST outputs
// and bitmaps it shows are real. Run via: npm run golden:zap
//
// It also checks its reading against zapx's own (through the segment
// API), so a misread of the format fails here, not on the page.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/RoaringBitmap/roaring/v2"
	_ "github.com/blevesearch/bleve/v2/analysis/analyzer/standard"
	"github.com/blevesearch/bleve/v2/document"
	"github.com/blevesearch/bleve/v2/registry"
	index "github.com/blevesearch/bleve_index_api"
	"github.com/blevesearch/vellum"
	zap "github.com/blevesearch/zapx/v17"
)

type hotel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	City        string `json:"city"`
	Description string `json:"description"`
}

type input struct {
	Deleted []string `json:"deleted"`
	Docs    []hotel  `json:"docs"`
}

// The JSON written for the page.

type region struct {
	ID    string `json:"id"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

type footerField struct {
	Name  string `json:"name"`
	Start int    `json:"start"`
	Size  int    `json:"size"`
	Value uint64 `json:"value"`
}

type fstTrans struct {
	B   byte   `json:"b"`
	To  int    `json:"to"`
	Out uint64 `json:"out"`
}

type fstState struct {
	Addr     int        `json:"addr"`
	Final    bool       `json:"final"`
	FinalOut uint64     `json:"finalOut"`
	Trans    []fstTrans `json:"trans"`
}

type hit struct {
	Doc      uint64 `json:"doc"`
	Freq     uint64 `json:"freq"`
	HasLocs  bool   `json:"hasLocs"`
	FieldLen uint64 `json:"fieldLen"`
}

type container struct {
	Key  uint16 `json:"key"`
	Type string `json:"type"`
	Card int    `json:"card"`
}

type term struct {
	Term  string `json:"term"`
	Value uint64 `json:"value"`
	Kind  string `json:"kind"` // "offset" or "1hit"
	// for "offset": the postings record
	PostingsStart int         `json:"postingsStart,omitempty"`
	FreqOffset    uint64      `json:"freqOffset,omitempty"`
	LocOffset     uint64      `json:"locOffset,omitempty"`
	BitmapStart   int         `json:"bitmapStart,omitempty"`
	BitmapLen     uint64      `json:"bitmapLen,omitempty"`
	Docs          []uint32    `json:"docs"`
	Containers    []container `json:"containers,omitempty"`
	ChunkSize     uint64      `json:"chunkSize,omitempty"`
	NumChunks     uint64      `json:"numChunks,omitempty"`
	Hits          []hit       `json:"hits,omitempty"`
}

type field struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Options    uint64 `json:"options"`
	InfoStart  int    `json:"infoStart"`
	Sections   []struct {
		Type uint16 `json:"type"`
		Addr uint64 `json:"addr"`
	} `json:"sections"`
	RecordStart int        `json:"recordStart,omitempty"`
	DvStart     uint64     `json:"dvStart,omitempty"`
	DvEnd       uint64     `json:"dvEnd,omitempty"`
	DictOffset  uint64     `json:"dictOffset,omitempty"`
	FstStart    int        `json:"fstStart,omitempty"`
	FstLen      uint64     `json:"fstLen,omitempty"`
	FstStates   []fstState `json:"fstStates,omitempty"`
	FstRoot     int        `json:"fstRoot,omitempty"`
	Terms       []term     `json:"terms,omitempty"`
}

type stored struct {
	Doc         int    `json:"doc"`
	ID          string `json:"id"`
	RecordStart int    `json:"recordStart"`
	MetaLen     uint64 `json:"metaLen"`
	DataLen     uint64 `json:"dataLen"`
	IDLen       uint64 `json:"idLen"`
	SnappyLen   uint64 `json:"snappyLen"`
}

type output struct {
	Note          string        `json:"note"`
	Size          int           `json:"size"`
	Bytes         string        `json:"bytes"` // base64 of the whole file
	Docs          []hotel       `json:"docs"`  // in doc-number order
	Deleted       []int         `json:"deleted"`
	Regions       []region      `json:"regions"`
	Footer        []footerField `json:"footer"`
	SectionsIndex struct {
		Start   int      `json:"start"`
		NF      uint64   `json:"nf"`
		Offsets []uint64 `json:"offsets"`
	} `json:"sectionsIndex"`
	NestedEdges int      `json:"nestedEdges"`
	Fields      []field  `json:"fields"`
	Stored      []stored `json:"stored"`
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func uvarint(b []byte, at int) (uint64, int) {
	v, n := binary.Uvarint(b[at:])
	if n <= 0 {
		panic(fmt.Sprintf("bad uvarint at %d", at))
	}
	return v, at + n
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: zap-golden <hotels.json> <out.json>")
		os.Exit(2)
	}
	var in input
	raw, err := os.ReadFile(os.Args[1])
	must(err)
	must(json.Unmarshal(raw, &in))

	// Analyze the docs as bleve would, with the standard analyzer:
	// name, city and description are indexed, stored text fields with
	// term vectors and doc values (as a default text field mapping).
	analyzer, err := registry.NewCache().AnalyzerNamed("standard")
	must(err)
	opts := index.IndexField | index.StoreField | index.IncludeTermVectors | index.DocValues
	var docs []index.Document
	for _, h := range in.Docs {
		d := document.NewDocument(h.ID)
		for _, f := range [][2]string{{"name", h.Name}, {"city", h.City}, {"description", h.Description}} {
			d.AddField(document.NewTextFieldCustom(f[0], nil, []byte(f[1]), opts, analyzer))
		}
		d.AddIDField()
		d.VisitFields(func(f index.Field) {
			if f.Options().IsIndexed() {
				f.Analyze()
			}
		})
		docs = append(docs, d)
	}

	// Build the segment with zapx and persist it, as the persister does.
	plugin := &zap.ZapPlugin{}
	seg, _, err := plugin.New(docs)
	must(err)
	dir, err := os.MkdirTemp("", "zap-golden")
	must(err)
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "000000000001.zap")
	must(zap.PersistSegmentBase(seg.(*zap.SegmentBase), path))
	b, err := os.ReadFile(path)
	must(err)

	out := output{
		Note:  "Generated by tools/zap-golden from its hotels.json with zapx v17. Don't edit; run npm run golden:zap.",
		Size:  len(b),
		Bytes: base64.StdEncoding.EncodeToString(b),
	}

	// The footer, read backwards from the end, as loadConfig() does.
	end := len(b)
	be32 := func(at int) uint64 { return uint64(binary.BigEndian.Uint32(b[at:])) }
	be64 := func(at int) uint64 { return binary.BigEndian.Uint64(b[at:]) }
	crc, version, chunkMode := end-4, end-8, end-12
	sectionsIdx, storedIdx, numDocs, idLen := end-20, end-28, end-36, end-40
	idLenV := be32(idLen)
	writerID := idLen - int(idLenV)
	out.Footer = []footerField{
		{"writerID", writerID, int(idLenV), 0},
		{"idLen", idLen, 4, idLenV},
		{"numDocs", numDocs, 8, be64(numDocs)},
		{"storedIndexOffset", storedIdx, 8, be64(storedIdx)},
		{"sectionsIndexOffset", sectionsIdx, 8, be64(sectionsIdx)},
		{"chunkMode", chunkMode, 4, be32(chunkMode)},
		{"version", version, 4, be32(version)},
		{"crc", crc, 4, be32(crc)},
	}
	if be32(version) != 17 {
		panic("not a v17 file")
	}
	nd := int(be64(numDocs))
	storedIndexOffset := int(be64(storedIdx))
	sectionsIndexOffset := int(be64(sectionsIdx))

	// The sections index: NF, then NF offsets into the sections info.
	nf, at := uvarint(b, sectionsIndexOffset)
	out.SectionsIndex.Start = sectionsIndexOffset
	out.SectionsIndex.NF = nf
	infoStart := sectionsIndexOffset
	for i := 0; i < int(nf); i++ {
		off := be64(at)
		at += 8
		out.SectionsIndex.Offsets = append(out.SectionsIndex.Offsets, off)
		if int(off) < infoStart {
			infoStart = int(off)
		}
	}

	// The nested-doc edges, after the stored index.
	edgesStart := storedIndexOffset + 8*nd
	nEdges, edgesEnd := uvarint(b, edgesStart)
	for i := 0; i < int(nEdges)*2; i++ {
		_, edgesEnd = uvarint(b, edgesEnd)
	}
	out.NestedEdges = int(nEdges)

	out.Regions = []region{
		{"storedData", 0, storedIndexOffset},
		{"storedIndex", storedIndexOffset, edgesStart},
		{"nestedEdges", edgesStart, edgesEnd},
		{"sectionBodies", edgesEnd, infoStart},
		{"sectionsInfo", infoStart, sectionsIndexOffset},
		{"sectionsIndex", sectionsIndexOffset, writerID},
		{"footer", writerID, end},
	}

	// The doc-number order is the batch order.
	out.Docs = in.Docs
	for i, h := range in.Docs {
		for _, del := range in.Deleted {
			if h.ID == del {
				out.Deleted = append(out.Deleted, i)
			}
		}
	}

	// Each field's info record, and (for text) its inverted index.
	for fid, off := range out.SectionsIndex.Offsets {
		f := field{ID: fid, InfoStart: int(off)}
		nameLen, p := uvarint(b, int(off))
		f.Name = string(b[p : p+int(nameLen)])
		p += int(nameLen)
		f.Options, p = uvarint(b, p)
		ns, p := uvarint(b, p)
		for s := 0; s < int(ns); s++ {
			var sec struct {
				Type uint16 `json:"type"`
				Addr uint64 `json:"addr"`
			}
			sec.Type = binary.BigEndian.Uint16(b[p:])
			sec.Addr = binary.BigEndian.Uint64(b[p+2:])
			p += 10
			f.Sections = append(f.Sections, sec)
		}
		sort.Slice(f.Sections, func(i, j int) bool { return f.Sections[i].Type < f.Sections[j].Type })
		for _, sec := range f.Sections {
			if sec.Type == 0 && sec.Addr != 0 { // the inverted text index
				readText(b, &f, int(sec.Addr), nd, uint32(be32(chunkMode)))
			}
		}
		out.Fields = append(out.Fields, f)
	}

	// Stored fields: storedIndex[doc] -> metaLen, dataLen, meta, data
	// (the _id bytes, then a snappy blob of the rest).
	for d := 0; d < nd; d++ {
		rec := int(be64(storedIndexOffset + 8*d))
		metaLen, p := uvarint(b, rec)
		dataLen, p := uvarint(b, p)
		idLen, _ := uvarint(b, p)
		dataStart := p + int(metaLen)
		out.Stored = append(out.Stored, stored{
			Doc: d, ID: string(b[dataStart : dataStart+int(idLen)]), RecordStart: rec,
			MetaLen: metaLen, DataLen: dataLen, IDLen: idLen, SnappyLen: dataLen - idLen,
		})
	}

	check(path, plugin, &out)

	js, err := json.MarshalIndent(out, "", " ")
	must(err)
	must(os.WriteFile(os.Args[2], append(js, '\n'), 0o644))
	fmt.Fprintf(os.Stderr, "wrote %s: a %d-byte segment, %d docs, %d fields\n", os.Args[2], len(b), nd, len(out.Fields))
}

// readText reads a field's inverted-text record: dvStart, dvEnd, then
// the dictionary offset, where a uvarint length precedes the FST.
func readText(b []byte, f *field, rec int, numDocs int, chunkMode uint32) {
	f.RecordStart = rec
	var p int
	f.DvStart, p = uvarint(b, rec)
	f.DvEnd, p = uvarint(b, p)
	f.DictOffset, _ = uvarint(b, p)
	var fstStart int
	f.FstLen, fstStart = uvarint(b, int(f.DictOffset))
	f.FstStart = fstStart
	fst, err := vellum.Load(b[fstStart : fstStart+int(f.FstLen)])
	must(err)

	// The FST's states, by walking every byte from every reachable state.
	f.FstRoot = fst.Start()
	seen := map[int]bool{}
	queue := []int{fst.Start()}
	for len(queue) > 0 {
		addr := queue[0]
		queue = queue[1:]
		if seen[addr] {
			continue
		}
		seen[addr] = true
		st := fstState{Addr: addr}
		st.Final, st.FinalOut = fst.IsMatchWithVal(addr)
		for c := 0; c < 256; c++ {
			to, outv := fst.AcceptWithVal(addr, byte(c))
			if to == 1 { // vellum's noneAddr: no transition
				continue
			}
			st.Trans = append(st.Trans, fstTrans{B: byte(c), To: to, Out: outv})
			queue = append(queue, to)
		}
		f.FstStates = append(f.FstStates, st)
	}
	sort.Slice(f.FstStates, func(i, j int) bool { return f.FstStates[i].Addr < f.FstStates[j].Addr })

	// Each term's value: an offset to its postings, or a 1-hit.
	it, err := fst.Iterator(nil, nil)
	for err == nil {
		k, v := it.Current()
		t := term{Term: string(k), Value: v}
		if v>>62 == 2 {
			t.Kind = "1hit"
			t.Docs = []uint32{uint32(v & 0x7fffffff)}
		} else {
			t.Kind = "offset"
			readPostings(b, &t, int(v&(1<<62-1)), numDocs, chunkMode)
		}
		f.Terms = append(f.Terms, t)
		err = it.Next()
	}
	if err != vellum.ErrIteratorDone {
		must(err)
	}
}

// readPostings reads a postings record (freqOffset, locOffset, the
// bitmap's length, the roaring bytes) and the freq/norm hits.
func readPostings(b []byte, t *term, at int, numDocs int, chunkMode uint32) {
	t.PostingsStart = at
	var p int
	t.FreqOffset, p = uvarint(b, at)
	t.LocOffset, p = uvarint(b, p)
	t.BitmapLen, p = uvarint(b, p)
	t.BitmapStart = p
	rb := roaring.New()
	_, err := rb.FromBuffer(b[p : p+int(t.BitmapLen)])
	must(err)
	t.Docs = rb.ToArray()
	// One container per 16-bit high key; zapx never run-optimizes, so
	// they're arrays (up to 4096 values) or bitmaps.
	byKey := map[uint16]int{}
	for _, d := range t.Docs {
		byKey[uint16(d>>16)]++
	}
	for k, n := range byKey {
		typ := "array"
		if n > 4096 {
			typ = "bitmap"
		}
		t.Containers = append(t.Containers, container{Key: k, Type: typ, Card: n})
	}
	sort.Slice(t.Containers, func(i, j int) bool { return t.Containers[i].Key < t.Containers[j].Key })

	// The freq/norm stream: numChunks, cumulative chunk ends, chunks;
	// a doc's hit is in chunk doc/chunkSize.
	t.ChunkSize = chunkSize(chunkMode, uint64(len(t.Docs)), uint64(numDocs))
	var ends []uint64
	t.NumChunks, p = uvarint(b, int(t.FreqOffset))
	for i := 0; i < int(t.NumChunks); i++ {
		var e uint64
		e, p = uvarint(b, p)
		ends = append(ends, e)
	}
	data := p
	cur := map[uint64]int{} // chunk -> read position
	for _, d := range t.Docs {
		c := uint64(d) / t.ChunkSize
		pos, ok := cur[c]
		if !ok {
			pos = data
			if c > 0 {
				pos += int(ends[c-1])
			}
		}
		fh, q := uvarint(b, pos)
		h := hit{Doc: uint64(d), Freq: fh >> 1, HasLocs: fh&1 == 1}
		if h.Freq > 0 {
			h.FieldLen, q = uvarint(b, q)
		}
		cur[c] = q
		t.Hits = append(t.Hits, h)
	}
}

// chunkSize mirrors zapx's getChunkSize (chunk.go) for the modes in use.
func chunkSize(mode uint32, card, maxDocs uint64) uint64 {
	switch {
	case mode <= 1024:
		return uint64(mode)
	case mode == 1025:
		if card <= 1024 {
			return maxDocs
		}
		return 1024
	default: // 1026
		n := maxDocs / (card/1024 + 1)
		if n == 0 {
			n = 1
		}
		return n
	}
}

// check compares what was read here with zapx's own reading.
func check(path string, plugin *zap.ZapPlugin, out *output) {
	s, err := plugin.Open(path)
	must(err)
	defer s.Close()
	for _, f := range out.Fields {
		if f.Terms == nil {
			continue
		}
		dict, err := s.Dictionary(f.Name)
		must(err)
		for _, t := range f.Terms {
			pl, err := dict.PostingsList([]byte(t.Term), nil, nil)
			must(err)
			it := pl.Iterator(true, true, false, nil)
			var got []uint32
			var hits []hit
			for {
				p, err := it.Next()
				must(err)
				if p == nil {
					break
				}
				got = append(got, uint32(p.Number()))
				hits = append(hits, hit{Doc: p.Number(), Freq: p.Frequency()})
			}
			if !equal(got, t.Docs) {
				panic(fmt.Sprintf("%s:%s: docs %v, zapx says %v", f.Name, t.Term, t.Docs, got))
			}
			for i, h := range t.Hits {
				if h.Freq != hits[i].Freq {
					panic(fmt.Sprintf("%s:%s: freq %d, zapx says %d", f.Name, t.Term, h.Freq, hits[i].Freq))
				}
			}
		}
	}
	for _, st := range out.Stored {
		id, err := s.DocID(uint64(st.Doc))
		must(err)
		if !bytes.Equal(id, []byte(st.ID)) {
			panic(fmt.Sprintf("doc %d: _id %q, zapx says %q", st.Doc, st.ID, id))
		}
	}
}

func equal(a, b []uint32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
