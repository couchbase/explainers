// vbmap-golden builds the real vbmap tool (couchbase/vbmap, from the
// checkout named in ../../../sources.yaml, or $EXPLAINERS_SRC_VBMAP)
// and runs it on the clusters the rebalance explainers show, with the
// flags ns_server passes (mb_map.erl's invoke_vbmap: --relax-all,
// --num-slaves 10) and fixed seeds. It prints, as JSON, each run's
// vbucket map and its diagnostics (which include the RI and R
// matrices). The explainers' maps come from here, not from a model.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type run struct {
	Nodes       []string `json:"nodes"`
	Racks       []string `json:"racks"`
	NumVBuckets int      `json:"numVBuckets"`
	NumReplicas int      `json:"numReplicas"`
	Seed        int      `json:"seed"`
	Map         [][]int  `json:"map"`
	Diag        string   `json:"diag"`
}

// The clusters: node names, in vbmap's node order, and each one's rack.
var cases = []struct {
	name     string
	nodes    string
	racks    string
	vbuckets int
	replicas int
}{
	// the story: a, b in rack East, c, d in rack West
	{"story4", "a,b,c,d", "East,East,West,West", 32, 1},
	// then e joins East and f joins West
	{"story6", "a,b,c,d,e,f", "East,East,West,West,East,West", 32, 1},
	// e alone joins East: racks of 3 and 2
	{"uneven5", "a,b,c,d,e", "East,East,West,West,East", 32, 1},
}

func main() {
	src := os.Getenv("EXPLAINERS_SRC_VBMAP")
	if src == "" {
		src = "../../../../../../couchbase-server.master/vbmap"
	}
	tmp, err := os.MkdirTemp("", "vbmap-golden")
	check(err)
	defer os.RemoveAll(tmp)
	bin := filepath.Join(tmp, "vbmap")
	build := exec.Command("go", "build", "-o", bin, ".")
	build.Dir = src
	build.Stderr = os.Stderr
	check(build.Run())

	out := map[string]run{}
	for _, c := range cases {
		nodes := strings.Split(c.nodes, ",")
		racks := strings.Split(c.racks, ",")
		rackIDs := map[string]int{}
		tags := []string{}
		for i, r := range racks {
			if _, ok := rackIDs[r]; !ok {
				rackIDs[r] = len(rackIDs)
			}
			tags = append(tags, fmt.Sprintf("%d:%d", i, rackIDs[r]))
		}
		diag := filepath.Join(tmp, c.name+".diag")
		cmd := exec.Command(bin,
			"-num-nodes", fmt.Sprint(len(nodes)),
			"-num-vbuckets", fmt.Sprint(c.vbuckets),
			"-num-replicas", fmt.Sprint(c.replicas),
			"-num-slaves", "10",
			"-tags", strings.Join(tags, ","),
			"-relax-all", "-seed", "1",
			"-diag", diag, "-output-format", "json")
		cmd.Stderr = os.Stderr
		stdout, err := cmd.Output()
		check(err)
		var m [][]int
		check(json.Unmarshal(stdout, &m))
		d, err := os.ReadFile(diag)
		check(err)
		// (the diagnostics, from the finalized parameters on, without
		// the run's own command line or timings)
		lines := []string{}
		for _, l := range strings.Split(string(d), "\n") {
			if strings.Contains(l, "wall clock") || strings.Contains(l, "Started as") || strings.Contains(l, "./vbmap") || strings.Contains(l, tmp) {
				continue
			}
			lines = append(lines, l)
		}
		out[c.name] = run{nodes, racks, c.vbuckets, c.replicas, 1, m, strings.Join(lines, "\n")}
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	check(enc.Encode(out))
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
