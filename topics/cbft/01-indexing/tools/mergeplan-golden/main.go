// Generates golden merge plans from bleve's real mergeplan package, so
// test/mergeplan.test.mjs can check that the JS port picks the same
// merges. Run via: npm run golden -- mergeplan (see golden.yaml)
package main

import (
	"encoding/json"
	"math/rand"
	"os"

	"github.com/blevesearch/bleve/v2/index/scorch/mergeplan"
)

type seg struct {
	ID           uint64 `json:"id"`
	Full         int64  `json:"fullSize"`
	Live         int64  `json:"liveSize"`
	File         int64  `json:"fileSize"`
	LiveFile     int64  `json:"liveFileSize"`
}

func (s *seg) Id() uint64          { return s.ID }
func (s *seg) FullSize() int64     { return s.Full }
func (s *seg) LiveSize() int64     { return s.Live }
func (s *seg) HasVector() bool     { return false }
func (s *seg) FileSize() int64     { return s.File }
func (s *seg) LiveFileSize() int64 { return s.LiveFile }

type opts struct {
	MaxSegmentsPerTier   int     `json:"maxSegmentsPerTier"`
	MaxSegmentSize       int64   `json:"maxSegmentSize"`
	TierGrowth           float64 `json:"tierGrowth"`
	SegmentsPerMergeTask int     `json:"segmentsPerMergeTask"`
	FloorSegmentSize     int64   `json:"floorSegmentSize"`
	FloorSegmentFileSize int64   `json:"floorSegmentFileSize"`
	ReclaimDeletesWeight float64 `json:"reclaimDeletesWeight"`
}

type testCase struct {
	Options  opts       `json:"options"`
	Segments []*seg     `json:"segments"`
	Tasks    [][]uint64 `json:"tasks"`
}

func main() {
	r := rand.New(rand.NewSource(42))
	var cases []testCase
	for i := 0; i < 300; i++ {
		o := opts{10, 5000000, 10.0, 10, 2000, 0, 2.0}
		if i%2 == 1 {
			o.FloorSegmentFileSize = 20 << 20 // cbft default
		}
		if i%7 == 3 {
			o.MaxSegmentsPerTier = 1 + r.Intn(12)
			o.SegmentsPerMergeTask = 2 + r.Intn(10)
			o.ReclaimDeletesWeight = float64(r.Intn(4))
		}
		n := 1 + r.Intn(40)
		var segs []*seg
		for j := 0; j < n; j++ {
			full := int64(1 + r.Intn([]int{500, 20000, 300000, 3000000}[r.Intn(4)]))
			live := full
			if r.Intn(3) == 0 {
				live = full - int64(r.Int63n(full+1))
			}
			file := full * int64(500+r.Intn(500))
			liveFile := int64(0)
			if full > 0 && live > 0 {
				liveFile = int64(float64(file) * float64(live) / float64(full))
			}
			// distinct sizes avoid unstable-sort ties between Go and JS
			segs = append(segs, &seg{uint64(j + 1), full, live, file, liveFile})
		}
		in := make([]mergeplan.Segment, len(segs))
		for j, s := range segs {
			in[j] = s
		}
		mo := mergeplan.MergePlanOptions{
			MaxSegmentsPerTier: o.MaxSegmentsPerTier, MaxSegmentSize: o.MaxSegmentSize,
			MaxSegmentFileSize: 4 << 30, TierGrowth: o.TierGrowth,
			SegmentsPerMergeTask: o.SegmentsPerMergeTask, FloorSegmentSize: o.FloorSegmentSize,
			FloorSegmentFileSize: o.FloorSegmentFileSize, ReclaimDeletesWeight: o.ReclaimDeletesWeight,
		}
		plan, err := mergeplan.Plan(in, &mo)
		if err != nil {
			panic(err)
		}
		tc := testCase{Options: o, Segments: segs, Tasks: [][]uint64{}}
		if plan != nil {
			for _, t := range plan.Tasks {
				var ids []uint64
				for _, s := range t.Segments {
					ids = append(ids, s.Id())
				}
				tc.Tasks = append(tc.Tasks, ids)
			}
		}
		cases = append(cases, tc)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	if err := enc.Encode(cases); err != nil {
		panic(err)
	}
}
