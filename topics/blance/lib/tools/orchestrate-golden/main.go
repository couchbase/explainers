// Generates golden orchestrations from the real blance (v0.1.6, as cbgt
// pins it): OrchestrateMoves, run for real, with an AssignPartitionsFunc
// that takes each batch a known time (the longest of its moves' times,
// as cbgt's waits for all of a batch's partitions), in milliseconds, and a FindMoveFunc that breaks ties by partition name.
// Each case runs several times; when two moves finish together, which
// the controller hears of first is a race, so a case with two batches
// ending at once (within 1ms), or whose runs differ, is marked unstable. test/orchestrate.test.mjs checks the simulation
// (lib/orchestrate.js) against the stable ones.
// Run via: npm run golden -- orchestrate (see golden.yaml)
package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/couchbase/blance"
)

const unit = time.Millisecond
const runs = 4

type batch struct {
	Node       string   `json:"node"`
	Partitions []string `json:"partitions"`
	States     []string `json:"states"`
	Ops        []string `json:"ops"`
	Start      int      `json:"start"`
	End        int      `json:"end"`
}

type tcase struct {
	Name          string                    `json:"name"`
	NodesAll      []string                  `json:"nodesAll"`
	BegMap        blance.PartitionMap       `json:"begMap"`
	EndMap        blance.PartitionMap       `json:"endMap"`
	MaxConcurrent int                       `json:"maxConcurrent"`
	FavorMinNodes bool                      `json:"favorMinNodes"`
	Durations     map[string]map[string]int `json:"durations"` // partition -> op -> units
	Stable        bool                      `json:"stable"`
	Batches       []batch                   `json:"batches"` // from the first run, by start
}

var model = blance.PartitionModel{
	"primary": {Priority: 0, Constraints: 1},
	"replica": {Priority: 1, Constraints: 1},
}

func clone(m blance.PartitionMap) blance.PartitionMap {
	r := blance.PartitionMap{}
	for k, p := range m {
		nbs := map[string][]string{}
		for s, ns := range p.NodesByState {
			nbs[s] = append([]string{}, ns...)
		}
		r[k] = &blance.Partition{Name: p.Name, NodesByState: nbs}
	}
	return r
}

func run(c *tcase) []batch {
	var mu sync.Mutex
	out := []batch{}
	t0 := time.Now()
	now := func() int { return int((time.Since(t0) + unit/2) / unit) }
	assign := func(stopCh chan struct{}, node string, partitions, states, ops []string) error {
		d := 0
		for i, p := range partitions {
			if x := c.Durations[p][ops[i]]; x > d {
				d = x
			}
		}
		b := batch{Node: node, Partitions: append([]string{}, partitions...), States: append([]string{}, states...), Ops: append([]string{}, ops...), Start: now()}
		time.Sleep(time.Duration(d) * unit)
		b.End = now()
		mu.Lock()
		out = append(out, b)
		mu.Unlock()
		return nil
	}
	find := func(node string, moves []blance.PartitionMove) int {
		r := 0
		for i, m := range moves {
			wi, wr := blance.MoveOpWeight[m.Op], blance.MoveOpWeight[moves[r].Op]
			if wi < wr || (wi == wr && m.Partition < moves[r].Partition) {
				r = i
			}
		}
		return r
	}
	o, err := blance.OrchestrateMoves(model, blance.OrchestratorOptions{
		MaxConcurrentPartitionMovesPerNode: c.MaxConcurrent, FavorMinNodes: c.FavorMinNodes,
	}, c.NodesAll, clone(c.BegMap), clone(c.EndMap), assign, find)
	if err != nil {
		panic(err)
	}
	for range o.ProgressCh() {
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Start != out[j].Start {
			return out[i].Start < out[j].Start
		}
		return out[i].Node < out[j].Node
	})
	return out
}

// What has to agree between runs: each node's batches, in order.
func shape(bs []batch) string {
	by := map[string][]string{}
	for _, b := range bs {
		ms := []string{}
		for i := range b.Partitions {
			ms = append(ms, b.Partitions[i]+":"+b.Ops[i])
		}
		by[b.Node] = append(by[b.Node], strings.Join(ms, ","))
	}
	nodes := []string{}
	for n := range by {
		nodes = append(nodes, n)
	}
	sort.Strings(nodes)
	s := []string{}
	for _, n := range nodes {
		s = append(s, n+"["+strings.Join(by[n], " ")+"]")
	}
	return strings.Join(s, " ")
}

func nodeNames(n int) []string {
	r := []string{}
	for i := 0; i < n; i++ {
		r = append(r, string(rune('a'+i)))
	}
	return r
}

func empty(n int) blance.PartitionMap {
	m := blance.PartitionMap{}
	for i := 0; i < n; i++ {
		k := fmt.Sprintf("%d", i)
		m[k] = &blance.Partition{Name: k, NodesByState: map[string][]string{}}
	}
	return m
}

func plan(prev blance.PartitionMap, all, remove, add []string) blance.PartitionMap {
	next, _ := blance.PlanNextMapEx(clone(prev), clone(prev), all, remove, add, model, blance.PlanNextMapOptions{})
	return next
}

func main() {
	cases := []*tcase{}
	r := rand.New(rand.NewSource(7))
	durations := func(np int, story bool) map[string]map[string]int {
		d := map[string]map[string]int{}
		for i := 0; i < np; i++ {
			p := fmt.Sprintf("%d", i)
			if story {
				// the explainer's: partitions of different sizes
				d[p] = map[string]int{"add": 270 + 27*i, "del": 18 + 9*i, "promote": 12, "demote": 12}
			} else {
				d[p] = map[string]int{"add": 60 + r.Intn(180), "del": 6 + r.Intn(30), "promote": 4 + r.Intn(15), "demote": 4 + r.Intn(15)}
			}
		}
		return d
	}
	// the explainer's scenarios: the first map, then d joins; then b leaves
	abc, abcd := nodeNames(3), nodeNames(4)
	m0 := plan(empty(8), abc, nil, abc)
	m1 := plan(m0, abcd, nil, []string{"d"})
	m2 := plan(m1, abcd, []string{"b"}, nil)
	for _, cfg := range []struct {
		maxc  int
		favor bool
	}{{1, false}, {2, false}, {4, false}, {1, true}} {
		cases = append(cases,
			&tcase{Name: fmt.Sprintf("story: add d, max %d, favorMinNodes %v", cfg.maxc, cfg.favor), NodesAll: abcd, BegMap: m0, EndMap: m1, MaxConcurrent: cfg.maxc, FavorMinNodes: cfg.favor, Durations: durations(8, true)},
			&tcase{Name: fmt.Sprintf("story: remove b, max %d, favorMinNodes %v", cfg.maxc, cfg.favor), NodesAll: abcd, BegMap: m1, EndMap: m2, MaxConcurrent: cfg.maxc, FavorMinNodes: cfg.favor, Durations: durations(8, true)})
	}
	// random cluster changes
	for i := 0; i < 24; i++ {
		np, nn := 2+r.Intn(10), 2+r.Intn(4)
		nodes := nodeNames(nn + 1)
		start := nodes[:nn]
		beg := plan(empty(np), start, nil, start)
		var end blance.PartitionMap
		switch r.Intn(3) {
		case 0:
			end = plan(beg, nodes, nil, nodes[nn:])
		case 1:
			end = plan(beg, start, []string{start[r.Intn(nn)]}, nil)
		default:
			end = plan(beg, nodes, []string{start[0]}, nodes[nn:])
		}
		cases = append(cases, &tcase{Name: fmt.Sprintf("random %d: %d partitions, %d nodes", i, np, nn), NodesAll: nodes, BegMap: beg, EndMap: end,
			MaxConcurrent: 1 + r.Intn(3), FavorMinNodes: r.Intn(3) == 0, Durations: durations(np, false)})
	}

	for _, c := range cases {
		first := run(c)
		// two batches ending together: which the controller hears of
		// first is a race, even if these runs happen to agree
		c.Batches, c.Stable = first, true
		for i, b := range first {
			for _, b2 := range first[:i] {
				if b.End-b2.End <= 1 && b2.End-b.End <= 1 {
					c.Stable = false
				}
			}
		}
		for k := 1; k < runs && c.Stable; k++ {
			if shape(run(c)) != shape(first) {
				c.Stable = false
			}
		}
	}
	fmt.Println(`{"note": "Generated by tools/orchestrate-golden with blance v0.1.6. Don't edit; run npm run golden -- orchestrate.",`)
	fmt.Println(` "cases": [`)
	for i, c := range cases {
		b, err := json.Marshal(c)
		if err != nil {
			panic(err)
		}
		sep := ","
		if i == len(cases)-1 {
			sep = ""
		}
		fmt.Printf("  %s%s\n", b, sep)
	}
	fmt.Println(" ]}")
}
