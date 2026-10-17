// query-golden builds the real n1k1 CLI (couchbase/n1k1, from the
// checkout named in ../../../sources.yaml, or $EXPLAINERS_SRC_N1K1) and
// runs the 01-query explainer's query on n1k1's own examples/shop data,
// with the catalog's indexes off (a plain scan), recording what the
// explainer shows: the keyspaces it found, its n1k1 op tree (.explain),
// the result rows (as n1k1 printed them), its per-operator stats, and
// the order files' bytes, in the order the scan reads them. The
// explainer's facts are checked against this, not a model.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const Query = "SELECT id, customer, total FROM orders WHERE total > 200 ORDER BY total DESC"

type file struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Doc  string `json:"doc"`
}

type out struct {
	Query     string   `json:"query"`
	Dataset   string   `json:"dataset"`
	Tables    []string `json:"tables"`
	Plan      []string `json:"plan"`
	Rows      []string `json:"rows"`
	Stats     []string `json:"stats"`
	Files     []file   `json:"files"`
	Customers []file   `json:"customers"`
}

func main() {
	src := os.Getenv("EXPLAINERS_SRC_N1K1")
	if src == "" {
		src = filepath.Join(os.Getenv("HOME"), "go/src/github.com/couchbase/n1k1")
	}
	tmp, err := os.MkdirTemp("", "n1k1-golden")
	check(err)
	defer os.RemoveAll(tmp)
	bin := filepath.Join(tmp, "n1k1")
	build := exec.Command("go", "build", "-tags", "n1ql", "-o", bin, "./cmd/n1k1")
	build.Dir = src
	build.Env = append(os.Environ(), "CGO_ENABLED=0", "GOPROXY=off")
	build.Stderr = os.Stderr
	check(build.Run())

	shop := filepath.Join(src, "examples/shop")
	run := func(stdin string, args ...string) []string {
		cmd := exec.Command(bin, append([]string{"-init", "none", "-index", "off"}, args...)...)
		cmd.Stdin = strings.NewReader(stdin)
		// (the stats and the plan go to stderr, after the rows)
		var b bytes.Buffer
		cmd.Stdout, cmd.Stderr = &b, &b
		err := cmd.Run()
		if err != nil {
			os.Stderr.Write(b.Bytes())
		}
		check(err)
		return lines(b.String())
	}
	o := out{Query: Query, Dataset: "examples/shop"}
	// (the rows, and the stats footer after them, minus its timings)
	timing := regexp.MustCompile(`row\(s\) in |^runtime:|^glossary:`)
	for _, l := range run("", "-mode", "jsonl", "-stats", "final", "-c", Query, shop) {
		switch {
		case strings.HasPrefix(l, "{"):
			o.Rows = append(o.Rows, l)
		case timing.MatchString(l), strings.HasPrefix(l, "stats:"):
		default:
			o.Stats = append(o.Stats, l)
		}
	}
	// (the op tree, after the rows .explain prints it with)
	plan := run(".explain on\n"+Query+";\n", shop)
	for i, l := range plan {
		if strings.HasPrefix(l, "n1k1 plan") {
			o.Plan = plan[i+1:]
			break
		}
	}
	o.Tables = run("", "-mode", "jsonl", "-c", ".tables", shop)
	o.Files = files(shop, "default/orders")
	o.Customers = files(shop, "default/customers")
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	enc.SetEscapeHTML(false)
	check(enc.Encode(o))
}

// files: a directory's files, sorted by name, as the scan lists them.
func files(root, dir string) []file {
	ms, err := filepath.Glob(filepath.Join(root, dir, "*.json"))
	check(err)
	sort.Strings(ms)
	out := []file{}
	for _, m := range ms {
		b, err := os.ReadFile(m)
		check(err)
		out = append(out, file{filepath.Base(m), filepath.Join(dir, filepath.Base(m)), strings.TrimRight(string(b), "\n")})
	}
	return out
}

func lines(s string) []string {
	out := []string{}
	for _, l := range strings.Split(strings.TrimRight(s, "\n"), "\n") {
		if strings.TrimSpace(l) != "" {
			out = append(out, strings.TrimRight(l, " "))
		}
	}
	return out
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
