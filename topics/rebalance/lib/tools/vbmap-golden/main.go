// vbmap-golden builds the real vbmap tool (couchbase/vbmap, from the
// checkout named in ../../../sources.yaml, or $EXPLAINERS_SRC_VBMAP)
// and runs it on the clusters the rebalance explainers show, with the
// flags ns_server passes (mb_map.erl's invoke_vbmap: --relax-all,
// --num-slaves 10, and by default --greedy and --current-map). It
// prints, as JSON, each run's vbucket map and its diagnostics. The
// explainers' maps come from here, not from a model.
//
// Two engines:
//   - greedy, ns_server's default (use_vbmap_greedy_optimization):
//     01-vbmap's runs. vbmap's greedy code walks Go maps, whose order
//     Go randomizes, so even a seeded run differs from run to run.
//     These runs use a copy of vbmap with those loops (see sortedLoops)
//     walking the nodes in order instead; nothing else is changed.
//   - max-flow (greedy off): 02-maxflow's runs, named maxflow-*.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type run struct {
	Nodes       []string `json:"nodes"`
	Racks       []string `json:"racks"`
	NumVBuckets int      `json:"numVBuckets"`
	NumReplicas int      `json:"numReplicas"`
	Seed        int      `json:"seed"`
	Engine      string   `json:"engine"`
	Current     string   `json:"current,omitempty"`
	Map         [][]int  `json:"map"`
	Diag        string   `json:"diag"`
}

var rack = map[string]string{"a": "West", "b": "West", "e": "West", "c": "East", "d": "East", "f": "East"}

// The node orders ns_server might shuffle the nodes into
// (generate_map_new: misc:shuffle, 3 times; here, 3 fixed orders).
var fiveOrders = []string{"a,b,c,d,e", "e,c,a,d,b", "d,e,b,c,a"}
var sixOrders = []string{"a,b,c,d,e,f", "f,c,a,e,d,b", "d,e,b,f,c,a"}

// The loops in vbmap's greedy code that walk Go maps, and what each
// becomes: the same loop over the map's nodes in order.
var sortedLoops = []struct{ from, to string }{
	{"\tfor node, cost := range costs {\n", "\tfor _, node := range sortedNodes(costs) {\n\t\tcost := costs[node]\n"},
	{"\tfor active, _ := range ri {\n", "\tfor _, active := range sortedNodes(map[Node]SlavesMap(ri)) {\n"},
	{"\tfor node, cost := range replicaCosts {\n", "\tfor _, node := range sortedNodes(replicaCosts) {\n\t\tcost := replicaCosts[node]\n"},
	{"\t\tfor active, numVbs := range activeNumVbsMap {\n", "\t\tfor _, active := range sortedNodes(activeNumVbsMap) {\n\t\t\tnumVbs := activeNumVbsMap[active]\n"},
	{"\tfor active, numVbs := range activeNumVbsMap {\n", "\tfor _, active := range sortedNodes(activeNumVbsMap) {\n\t\tnumVbs := activeNumVbsMap[active]\n"},
}

const sortedNodesGo = `package main

import "sort"

// (added by the explainers' vbmap-golden: a map's nodes, in order)
func sortedNodes[V any](m map[Node]V) []Node {
	nodes := make([]Node, 0, len(m))
	for n := range m {
		nodes = append(nodes, n)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i] < nodes[j] })
	return nodes
}
`

func main() {
	src := os.Getenv("EXPLAINERS_SRC_VBMAP")
	if src == "" {
		src = "../../../../../../couchbase-server.master/vbmap"
	}
	tmp, err := os.MkdirTemp("", "vbmap-golden")
	check(err)
	defer os.RemoveAll(tmp)
	asIs := build(src, filepath.Join(tmp, "vbmap"))
	sorted := build(patched(src, filepath.Join(tmp, "src-sorted")), filepath.Join(tmp, "vbmap-sorted"))

	out := map[string]run{}
	do := func(name, order string, seed int, greedy bool, current string) {
		bin, engine := asIs, "max-flow"
		if greedy {
			bin, engine = sorted, "greedy"
		}
		out[name] = vbmap(bin, tmp, name, strings.Split(order, ","), seed, engine, current, out)
	}

	// max-flow, for 02-maxflow: the story's four nodes, five (racks of
	// 3 and 2), and six, nine times
	do("maxflow-story4", "a,b,c,d", 1, false, "")
	do("maxflow-uneven5", "a,b,c,d,e", 1, false, "")
	for i, order := range sixOrders {
		for seed := 1; seed <= 3; seed++ {
			do(fmt.Sprintf("maxflow-six-%d-%d", i+1, seed), order, seed, false, "")
		}
	}

	// greedy, for 01-vbmap: the story's four nodes; node e joins (nine
	// tries, from the four-node map; ns_server keeps the cheapest); then
	// node f joins (nine tries, from that)
	do("story4", "a,b,c,d", 1, true, "")
	tries := func(prefix string, orders []string, current string) {
		for i, order := range orders {
			for seed := 1; seed <= 3; seed++ {
				do(fmt.Sprintf("%s-%d-%d", prefix, i+1, seed), order, seed, true, current)
			}
		}
	}
	tries("five", fiveOrders, "story4")
	five := pick(out, "five", "story4")
	tries("six", sixOrders, five)
	six := pick(out, "six", five)

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	check(enc.Encode(map[string]any{"runs": out, "picks": map[string]string{"five": five, "six": six}}))
}

// build builds vbmap from dir into bin.
func build(dir, bin string) string {
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	check(cmd.Run())
	return bin
}

// patched copies vbmap's source into dir, with sortedLoops applied.
func patched(src, dir string) string {
	check(os.MkdirAll(dir, 0o755))
	files, err := filepath.Glob(filepath.Join(src, "*"))
	check(err)
	for _, f := range files {
		base := filepath.Base(f)
		if !(strings.HasSuffix(base, ".go") || base == "go.mod" || base == "go.sum") || strings.HasSuffix(base, "_test.go") {
			continue
		}
		b, err := os.ReadFile(f)
		check(err)
		s := string(b)
		if base == "greedy.go" {
			for _, l := range sortedLoops {
				// (each loop must still be there, once: if vbmap changes,
				// say so; the indented one of the two alike goes first)
				if n := strings.Count(s, l.from); n != 1 {
					check(fmt.Errorf("greedy.go: expected %q, found it %d times", l.from, n))
				}
				s = strings.ReplaceAll(s, l.from, l.to)
			}
		}
		check(os.WriteFile(filepath.Join(dir, base), []byte(s), 0o644))
	}
	check(os.WriteFile(filepath.Join(dir, "zz_sorted_nodes.go"), []byte(sortedNodesGo), 0o644))
	return dir
}

// vbmap runs bin on nodes (in that order: vbmap's node ids), from the
// current map of run current, if any.
func vbmap(bin, tmp, name string, nodes []string, seed int, engine, current string, runs map[string]run) run {
	racks, rackIDs, tags := []string{}, map[string]int{}, []string{}
	for i, n := range nodes {
		r := rack[n]
		if _, ok := rackIDs[r]; !ok {
			rackIDs[r] = len(rackIDs)
		}
		racks = append(racks, r)
		tags = append(tags, fmt.Sprintf("%d:%d", i, rackIDs[r]))
	}
	diag := filepath.Join(tmp, name+".diag")
	args := []string{
		"-num-nodes", fmt.Sprint(len(nodes)), "-num-vbuckets", "32", "-num-replicas", "1",
		"-num-slaves", "10", "-tags", strings.Join(tags, ","),
		"-relax-all", "-seed", fmt.Sprint(seed), "-diag", diag, "-output-format", "json",
	}
	if engine == "greedy" {
		args = append(args, "-greedy")
	}
	if current != "" {
		// (the current map, in this run's node ids, as ns_server writes
		// it: a node that isn't in the run is -1)
		ids := map[string]int{}
		for i, n := range nodes {
			ids[n] = i
		}
		cur := [][]int{}
		for _, chain := range named(runs, current) {
			c := []int{}
			for _, n := range chain {
				if id, ok := ids[n]; ok {
					c = append(c, id)
				} else {
					c = append(c, -1)
				}
			}
			cur = append(cur, c)
		}
		path := filepath.Join(tmp, name+".current.json")
		b, _ := json.Marshal(cur)
		check(os.WriteFile(path, b, 0o644))
		args = append(args, "-current-map", path)
	}
	cmd := exec.Command(bin, args...)
	// (vbmap seeds math/rand with rand.Seed, which Go 1.24 made a no-op
	// by default; this makes -seed count)
	cmd.Env = append(os.Environ(), "GODEBUG=randseednop=0")
	cmd.Stderr = os.Stderr
	stdout, err := cmd.Output()
	check(err)
	var m [][]int
	check(json.Unmarshal(stdout, &m))
	d, err := os.ReadFile(diag)
	check(err)
	// (the diagnostics, from the finalized parameters on, without the
	// run's own command line, paths or timings)
	lines := []string{}
	for _, l := range strings.Split(string(d), "\n") {
		if strings.Contains(l, "wall clock") || strings.Contains(l, "Time spent") || strings.Contains(l, "Started as") || strings.Contains(l, tmp) {
			continue
		}
		lines = append(lines, l)
	}
	return run{nodes, racks, 32, 1, seed, engine, current, m, strings.Join(lines, "\n")}
}

// named: a run's map, with node names.
func named(runs map[string]run, name string) [][]string {
	r := runs[name]
	out := [][]string{}
	for _, chain := range r.Map {
		c := []string{}
		for _, i := range chain {
			c = append(c, r.Nodes[i])
		}
		out = append(out, c)
	}
	return out
}

// pick: of the runs named prefix-*, the one ns_server keeps, from the
// current map of run current (generate_map_new: each map seated by
// maybe_simple_minimize_moves, scored by vbucket_movements, the
// cheapest kept; of equals, the first). The same as ../../rebalance.js,
// which the explainer uses; its tests check the two agree.
func pick(runs map[string]run, prefix, current string) string {
	names := []string{}
	for k := range runs {
		if strings.HasPrefix(k, prefix+"-") {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	cur := named(runs, current)
	keep := runs[names[0]].Nodes
	best, bestScore := "", [2]int{}
	for _, n := range names {
		_, score := maybeMinimize(cur, named(runs, n), keep)
		if best == "" || less(score, bestScore) {
			best, bestScore = n, score
		}
	}
	return best
}

const undef = "undefined"

func listcmp(a, b []string) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func termcmp(a, b []string) int {
	if c := listcmp(a, b); c != 0 {
		return c
	}
	return len(a) - len(b)
}

type numbered struct {
	v     int
	chain []string
}

func simpleMinimizeMoves(current, chains [][]string, numCopies int, keep []string) [][]string {
	left := []numbered{}
	for v, chain := range current {
		c := []string{}
		for _, n := range chain[:numCopies] {
			if contains(keep, n) {
				c = append(c, n)
			} else {
				c = append(c, undef)
			}
		}
		left = append(left, numbered{v, c})
	}
	cands := append([][]string{}, chains...)
	sort.SliceStable(cands, func(i, j int) bool { return termcmp(cands[i], cands[j]) < 0 })
	out := make([][]string, len(current))
	for shift := 0; shift <= numCopies; shift++ {
		sorted := append([]numbered{}, left...)
		sort.SliceStable(sorted, func(i, j int) bool { return termcmp(sorted[i].chain[shift:], sorted[j].chain[shift:]) < 0 })
		rest1, rest2 := []numbered{}, [][]string{}
		i, j := 0, 0
		for i < len(sorted) && j < len(cands) {
			switch c := listcmp(sorted[i].chain[shift:], cands[j]); {
			case c < 0:
				rest1 = append(rest1, sorted[i])
				i++
			case c > 0:
				rest2 = append(rest2, cands[j])
				j++
			default:
				out[sorted[i].v] = cands[j]
				i++
				j++
			}
		}
		left = append(rest1, sorted[i:]...)
		cands = append(rest2, cands[j:]...)
	}
	return out
}

func movements(src, dst [][]string) [2]int {
	scratch, takeovers := 0, 0
	for v := range src {
		if src[v][0] != dst[v][0] {
			takeovers++
		}
		for _, n := range dst[v] {
			if n != undef && !contains(src[v], n) {
				scratch++
			}
		}
	}
	return [2]int{scratch, takeovers}
}

func less(a, b [2]int) bool { return a[0] < b[0] || (a[0] == b[0] && a[1] < b[1]) }

func maybeMinimize(current, chains [][]string, keep []string) ([][]string, [2]int) {
	asDealt := movements(current, chains)
	seated := simpleMinimizeMoves(current, chains, len(chains[0]), keep)
	score := movements(current, seated)
	if less(asDealt, score) {
		return chains, asDealt
	}
	return seated, score
}

func contains(s []string, x string) bool {
	for _, y := range s {
		if y == x {
			return true
		}
	}
	return false
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
