// Generates golden plans from the real blance (v0.1.6, as cbgt pins
// it): seeded random clusters, and the scenarios the explainers tell,
// each with blance's next map, its warnings, and every partition's
// moves (CalcPartitionMoves, both ways). test/plan.test.mjs checks the
// JS port (lib/plan.js, lib/moves.js) against them.
// Run via: npm run golden -- blance (see golden.yaml)
package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"

	"github.com/couchbase/blance"
)

// The options, as the JS port names them. A nil map is null, an empty
// one {}: blance treats them differently (see plan.go:104-115).
type opts struct {
	ModelStateConstraints map[string]int    `json:"modelStateConstraints"`
	PartitionWeights      map[string]int    `json:"partitionWeights"`
	StateStickiness       map[string]int    `json:"stateStickiness"`
	NodeWeights           map[string]int    `json:"nodeWeights"`
	NodeHierarchy         map[string]string `json:"nodeHierarchy"`
	HierarchyRules        blance.HierarchyRules `json:"hierarchyRules"`
}

type move struct {
	Node  string `json:"node"`
	State string `json:"state"`
	Op    string `json:"op"`
}

type tcase struct {
	Name               string                `json:"name"`
	PrevMap            blance.PartitionMap   `json:"prevMap"`
	PartitionsToAssign blance.PartitionMap   `json:"-"` // (always prevMap)
	NodesAll           []string              `json:"nodesAll"`
	NodesToRemove      []string              `json:"nodesToRemove"`
	NodesToAdd         []string              `json:"nodesToAdd"`
	Model              blance.PartitionModel `json:"model"`
	Opts               opts                  `json:"opts"`

	NextMap  blance.PartitionMap `json:"nextMap"`
	Warnings map[string][]string `json:"warnings"`
	// per partition, from prevMap to nextMap
	Moves         map[string][]move `json:"moves"`
	MovesMinNodes map[string][]move `json:"movesMinNodes"`
}

func model(replicas int) blance.PartitionModel {
	return blance.PartitionModel{
		"primary": {Priority: 0, Constraints: 1},
		"replica": {Priority: 1, Constraints: replicas},
	}
}

func empty(n int) blance.PartitionMap {
	m := blance.PartitionMap{}
	for i := 0; i < n; i++ {
		k := fmt.Sprintf("%d", i)
		m[k] = &blance.Partition{Name: k, NodesByState: map[string][]string{}}
	}
	return m
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

func toBlance(o opts) blance.PlanNextMapOptions {
	return blance.PlanNextMapOptions{
		ModelStateConstraints: o.ModelStateConstraints,
		PartitionWeights:      o.PartitionWeights,
		StateStickiness:       o.StateStickiness,
		NodeWeights:           o.NodeWeights,
		NodeHierarchy:         o.NodeHierarchy,
		HierarchyRules:        o.HierarchyRules,
	}
}

func states(m blance.PartitionModel) []string {
	r := []string{}
	for s := range m {
		r = append(r, s)
	}
	sort.Slice(r, func(i, j int) bool {
		if m[r[i]].Priority != m[r[j]].Priority {
			return m[r[i]].Priority < m[r[j]].Priority
		}
		return r[i] < r[j]
	})
	return r
}

func movesOf(st []string, a, b blance.PartitionMap, favorMinNodes bool) map[string][]move {
	r := map[string][]move{}
	for name, pa := range a {
		pb := b[name]
		if pb == nil {
			continue
		}
		ms := []move{}
		for _, x := range blance.CalcPartitionMoves(st, pa.NodesByState, pb.NodesByState, favorMinNodes) {
			ms = append(ms, move{x.Node, x.State, x.Op})
		}
		r[name] = ms
	}
	return r
}

// run plans one case, recording its inputs before blance (which
// updates prevMap and partitionsToAssign in place) sees them.
func run(name string, prev blance.PartitionMap, all, remove, add []string, m blance.PartitionModel, o opts) (tcase, blance.PartitionMap) {
	c := tcase{Name: name, PrevMap: clone(prev), PartitionsToAssign: clone(prev),
		NodesAll: all, NodesToRemove: remove, NodesToAdd: add, Model: m, Opts: o}
	next, warnings := blance.PlanNextMapEx(clone(prev), clone(prev), all, remove, add, m, toBlance(o))
	c.NextMap, c.Warnings = next, warnings
	c.Moves = movesOf(states(m), c.PrevMap, next, false)
	c.MovesMinNodes = movesOf(states(m), c.PrevMap, next, true)
	return c, clone(next)
}

func nodeNames(n int) []string {
	r := []string{}
	for i := 0; i < n; i++ {
		r = append(r, string(rune('a'+i)))
	}
	return r
}

func main() {
	cases := []tcase{}
	add := func(c tcase, _ blance.PartitionMap) { cases = append(cases, c) }

	// ---- the scenarios the explainers tell ----
	abc, abcd := nodeNames(3), nodeNames(4)
	c, m0 := run("story: fresh, 8 partitions, nodes a b c, 1 replica", empty(8), abc, nil, abc, model(1), opts{})
	add(c, m0)
	c, m1 := run("story: add d", m0, abcd, nil, []string{"d"}, model(1), opts{})
	add(c, m1)
	add(run("story: remove b", m1, abcd, []string{"b"}, nil, model(1), opts{}))
	add(run("story: add d, stickiness 100000, partition weights nil", m0, abcd, nil, []string{"d"}, model(1),
		opts{StateStickiness: map[string]int{"primary": 100000, "replica": 100000}}))
	add(run("story: add d, stickiness 100000, partition weights {}", m0, abcd, nil, []string{"d"}, model(1),
		opts{StateStickiness: map[string]int{"primary": 100000, "replica": 100000}, PartitionWeights: map[string]int{}}))
	add(run("story: add d, stickiness 0, partition weights {}", m0, abcd, nil, []string{"d"}, model(1),
		opts{StateStickiness: map[string]int{"primary": 0, "replica": 0}, PartitionWeights: map[string]int{}}))
	groups := map[string]string{"a": "g1", "b": "g1", "c": "g2", "d": "g2", "g1": "dc", "g2": "dc"}
	otherGroup := blance.HierarchyRules{"replica": {{IncludeLevel: 2, ExcludeLevel: 1}}}
	add(run("story: fresh, nodes a b c d, no groups", empty(8), abcd, nil, abcd, model(1), opts{}))
	add(run("story: fresh, groups g1={a,b} g2={c,d}, replica in the other group", empty(8), abcd, nil, abcd, model(1),
		opts{NodeHierarchy: groups, HierarchyRules: otherGroup}))
	add(run("story: fresh, node c weighs 2", empty(8), abcd, nil, abcd, model(1),
		opts{NodeWeights: map[string]int{"c": 2}}))

	// ---- random clusters ----
	r := rand.New(rand.NewSource(42))
	for i := 0; i < 160; i++ {
		np := 1 + r.Intn(16)
		nn := 1 + r.Intn(6)
		replicas := r.Intn(3)
		nodes := nodeNames(nn)
		o := opts{}
		switch r.Intn(4) {
		case 1:
			o.PartitionWeights = map[string]int{}
		case 2:
			o.PartitionWeights = map[string]int{}
			for p := 0; p < np; p++ {
				if r.Intn(2) == 0 {
					o.PartitionWeights[fmt.Sprintf("%d", p)] = 1 + r.Intn(4)
				}
			}
		}
		if r.Intn(3) == 0 {
			o.StateStickiness = map[string]int{"primary": []int{0, 1, 2, 5, 100000}[r.Intn(5)], "replica": []int{0, 1, 2, 5}[r.Intn(4)]}
		}
		if r.Intn(3) == 0 {
			o.NodeWeights = map[string]int{}
			for _, n := range nodes {
				if r.Intn(2) == 0 {
					o.NodeWeights[n] = 1 + r.Intn(3)
				}
			}
		}
		if r.Intn(3) == 0 && nn >= 2 {
			ng := 2 + r.Intn(2)
			o.NodeHierarchy = map[string]string{}
			for j, n := range nodes {
				o.NodeHierarchy[n] = fmt.Sprintf("g%d", j%ng)
			}
			for g := 0; g < ng; g++ {
				o.NodeHierarchy[fmt.Sprintf("g%d", g)] = "dc"
			}
			o.HierarchyRules = blance.HierarchyRules{"replica": {{IncludeLevel: []int{1, 2}[r.Intn(2)], ExcludeLevel: []int{0, 1}[r.Intn(2)]}}}
		}
		if r.Intn(8) == 0 {
			o.ModelStateConstraints = map[string]int{"replica": r.Intn(3)}
		}
		m := model(replicas)
		// start from a plan on some of the nodes, then change the cluster
		start := nodes[:1+r.Intn(nn)]
		_, prev := run("", empty(np), start, nil, start, m, opts{})
		kind := r.Intn(4)
		name := fmt.Sprintf("random %d: %d partitions, %d nodes, %d replicas", i, np, nn, replicas)
		switch {
		case kind == 0:
			add(run(name+", fresh", empty(np), nodes, nil, nodes, m, o))
		case kind == 1 && len(start) < nn:
			add(run(name+", add nodes", prev, nodes, nil, nodes[len(start):], m, o))
		case kind == 2 && len(start) > 1:
			rm := []string{start[r.Intn(len(start))]}
			add(run(name+", remove a node", prev, start, rm, nil, m, o))
		default:
			rm := []string{}
			if len(start) > 1 {
				rm = []string{start[0]}
			}
			add(run(name+", swap", prev, nodes, rm, nodes[len(start):], m, o))
		}
	}

	// one case per line, for readable diffs
	fmt.Println(`{"note": "Generated by tools/plan-golden with blance v0.1.6. Don't edit; run npm run golden -- blance.",`)
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
