// boxed-golden measures, for real, what 01-query's filter costs per row
// in n1k1's two expression lanes, for the 03-boxed explainer: the byte
// lane (n1k1's native code, as glue.ExprTree makes it) and the boxed
// lane (cbq's Evaluate, the steps glue.ExprTree's fallback takes:
// ConvertVals.Convert, Evaluate, WriteJSON). Over the 20 order files
// (examples/shop), it records each lane's answers, and its allocations
// per row: in all, and, for the boxed lane, each one by where it
// happened (from the Go heap profiler, at a rate of 1). And what a
// total becomes, boxed and written back.
//
// It runs a small program in a temp module that uses the n1k1 checkout
// (../../../sources.yaml, or $EXPLAINERS_SRC_N1K1) by a replace
// directive; the checkout itself is never written to.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func main() {
	src := os.Getenv("EXPLAINERS_SRC_N1K1")
	if src == "" {
		src = filepath.Join(os.Getenv("HOME"), "go/src/github.com/couchbase/n1k1")
	}
	tmp, err := os.MkdirTemp("", "n1k1-boxed-golden")
	check(err)
	defer os.RemoveAll(tmp)
	dir := module(tmp, "measure", src, strings.ReplaceAll(MEASURE, "SRC", fmt.Sprintf("%q", src)))
	var out json.RawMessage
	check(json.Unmarshal(run(dir), &out))
	os.Stdout.Write(out)
	os.Stdout.Write([]byte("\n"))
}

// A temp module that uses the n1k1 checkout, with one main.go.
func module(tmp, name, src, code string) string {
	dir := filepath.Join(tmp, name)
	check(os.MkdirAll(dir, 0o755))
	mod, err := os.ReadFile(filepath.Join(src, "go.mod"))
	check(err)
	var gm strings.Builder
	fmt.Fprintf(&gm, "module %s\n\ngo 1.25.0\n\nrequire github.com/couchbase/n1k1 v0.0.0\n\nreplace github.com/couchbase/n1k1 => %s\n", name, src)
	for _, l := range strings.Split(string(mod), "\n") {
		if strings.HasPrefix(l, "replace ") {
			gm.WriteString(l + "\n")
		}
	}
	check(os.WriteFile(filepath.Join(dir, "go.mod"), []byte(gm.String()), 0o644))
	sum, err := os.ReadFile(filepath.Join(src, "go.sum"))
	check(err)
	check(os.WriteFile(filepath.Join(dir, "go.sum"), sum, 0o644))
	check(os.WriteFile(filepath.Join(dir, "main.go"), []byte(code), 0o644))
	return dir
}

func run(dir string) []byte {
	cmd := exec.Command("go", "run", "-tags", "n1ql", ".")
	cmd.Dir = dir
	// (-mod=mod writes only the temp module's go.mod)
	cmd.Env = append(os.Environ(), "GOFLAGS=-mod=mod", "GOPROXY=off", "CGO_ENABLED=0")
	cmd.Stderr = os.Stderr
	b, err := cmd.Output()
	check(err)
	return b
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

const MEASURE = `//go:build n1ql

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/couchbase/n1k1/base"
	"github.com/couchbase/n1k1/glue"
	"github.com/couchbase/n1k1/rt"
	"github.com/couchbase/query/expression"
	"github.com/couchbase/query/value"
)

// Where a boxed-lane allocation happened: its stage, and what it is,
// by the frames on its stack (the first rule that matches).
var RULES = []struct{ stage, what string; has []string }{
	{"convert", "the row, as a map", []string{"ConvertVals).Convert", "makemap_small"}},
	{"convert", "the map's room for \"orders\"", []string{"objectValue.setField", "ConvertVals).Convert"}},
	{"convert", "a parsedValue, around the doc's bytes", []string{"newParsedValue", "ConvertVals).Convert"}},
	{"convert", "an annotatedValue, to carry the doc's META", []string{"newAnnotatedValue", "ConvertVals).Convert"}},
	{"convert", "the META map, for the id", []string{"SetMetaField", "ConvertVals).Convert"}},
	{"convert", "the id, parsed and boxed", []string{"variantAwareParsed", "ConvertVals).Convert"}},
	{"evaluate", "a scanner, to find \"total\" in the doc", []string{"FindKey", "Field).Evaluate"}},
	{"evaluate", "the total, parsed and boxed", []string{"Field).Evaluate"}},
	{"compare", "the comparison's working value", []string{"LT).Evaluate"}},
	{"write", "the answer, written as JSON", []string{"WriteJSON"}},
	{"other", "other", []string{"Convert"}},
}

func classify(stack []uintptr) (string, string, bool) {
	fr := runtime.CallersFrames(stack)
	var fs []string
	mine := false
	for {
		f, more := fr.Next()
		fs = append(fs, f.Function)
		if strings.HasPrefix(f.Function, "main.boxedRow") {
			mine = true
		}
		if !more {
			break
		}
	}
	if !mine {
		return "", "", false
	}
	all := strings.Join(fs, " ")
	for _, r := range RULES {
		ok := true
		for _, h := range r.has {
			if !strings.Contains(all, h) {
				ok = false
			}
		}
		if ok {
			return r.stage, r.what, true
		}
	}
	return "other", "other", true
}

var labels = base.Labels{` + "`" + `.["orders"]` + "`" + `, "^id"}

func expr() expression.Expression {
	return expression.NewLT(expression.NewConstant(200),
		expression.NewField(expression.NewIdentifier("orders"), expression.NewFieldName("total", false)))
}

var cv *glue.ConvertVals
var ctx = glue.NewExprGlueContext(time.Unix(0, 0))
var bexpr = expr()
var buf bytes.Buffer

//go:noinline
func boxedRow(vals base.Vals) []byte {
	v, err := cv.Convert(vals)
	if err != nil {
		panic(err)
	}
	r, err := bexpr.Evaluate(v, ctx)
	if err != nil {
		panic(err)
	}
	buf.Reset()
	r.WriteJSON(nil, &buf, "", "", true)
	return buf.Bytes()
}

type alloc struct {
	Stage string  ` + "`json:\"stage\"`" + `
	What  string  ` + "`json:\"what\"`" + `
	Count float64 ` + "`json:\"count\"`" + `
	Bytes float64 ` + "`json:\"bytes\"`" + `
}

type row struct {
	File        string  ` + "`json:\"file\"`" + `
	Native      string  ` + "`json:\"native\"`" + `
	Boxed       string  ` + "`json:\"boxed\"`" + `
	NativeAlloc float64 ` + "`json:\"nativeAllocs\"`" + `
	BoxedAlloc  float64 ` + "`json:\"boxedAllocs\"`" + `
	BoxedBytes  float64 ` + "`json:\"boxedBytes\"`" + `
	Allocs      []alloc ` + "`json:\"allocs\"`" + `
	TotalBoxed  string  ` + "`json:\"totalBoxed\"`" + `
	TotalType   string  ` + "`json:\"totalType\"`" + `
}

const N = 1000

func main() {
	files, _ := filepath.Glob(filepath.Join(SRC, "examples/shop/default/orders/*.json"))
	sort.Strings(files)
	var err error
	cv, err = glue.NewConvertVals(labels)
	if err != nil {
		panic(err)
	}
	vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-boxed-golden")}
	native := glue.ExprTree(vars, labels, []interface{}{expr()}, "")
	ye := func(error) {}
	var rows []row
	for _, f := range files {
		b, _ := os.ReadFile(f)
		stem := strings.TrimSuffix(filepath.Base(f), ".json")
		vals := base.Vals{bytes.TrimSpace(b), []byte(fmt.Sprintf("%q", stem))}
		r := row{File: filepath.Base(f), Native: string(native(vals, ye)), Boxed: string(boxedRow(vals))}
		r.NativeAlloc = testing.AllocsPerRun(N, func() { native(vals, ye) })
		r.BoxedAlloc = testing.AllocsPerRun(N, func() { boxedRow(vals) })

		// each boxed allocation, by where it happened
		runtime.MemProfileRate = 1
		before := profile()
		for k := 0; k < N; k++ {
			boxedRow(vals)
		}
		runtime.GC()
		after := profile()
		runtime.MemProfileRate = 512 * 1024
		got := map[[2]string]*alloc{}
		var keys [][2]string
		for k, a := range after {
			n, by := a[0]-before[k][0], a[1]-before[k][1]
			if n == 0 {
				continue
			}
			key := [2]string{k.stage, k.what}
			if got[key] == nil {
				got[key] = &alloc{Stage: k.stage, What: k.what}
				keys = append(keys, key)
			}
			got[key].Count += float64(n)
			got[key].Bytes += float64(by)
		}
		for _, k := range RULESORDER(keys) {
			a := got[k]
			a.Count, a.Bytes = round(a.Count/N), round(a.Bytes/N)
			if a.Count > 0 {
				r.Allocs = append(r.Allocs, *a)
				r.BoxedBytes += a.Bytes
			}
		}

		// the total, boxed, and written back
		v, _ := cv.Convert(vals)
		o, _ := v.Field("orders")
		t, _ := o.Field("total")
		var tb bytes.Buffer
		t.WriteJSON(nil, &tb, "", "", true)
		r.TotalBoxed, r.TotalType = tb.String(), fmt.Sprintf("%T", t)
		_ = value.MISSING
		rows = append(rows, r)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]interface{}{"expr": "200 < orders.total", "rows": rows})
}

func round(x float64) float64 { return math.Round(x) }

type site struct{ stage, what string }

func profile() map[site][2]int64 {
	runtime.GC()
	n, _ := runtime.MemProfile(nil, true)
	recs := make([]runtime.MemProfileRecord, n+100)
	n, _ = runtime.MemProfile(recs, true)
	out := map[site][2]int64{}
	for _, r := range recs[:n] {
		st, what, ok := classify(r.Stack())
		if !ok {
			continue
		}
		k := site{st, what}
		x := out[k]
		x[0] += r.AllocObjects
		x[1] += r.AllocBytes
		out[k] = x
	}
	return out
}

// (in the order of RULES)
func RULESORDER(keys [][2]string) [][2]string {
	idx := func(k [2]string) int {
		for i, r := range RULES {
			if r.stage == k[0] && r.what == k[1] {
				return i
			}
		}
		return len(RULES)
	}
	sort.Slice(keys, func(i, j int) bool { return idx(keys[i]) < idx(keys[j]) })
	return keys
}
`
