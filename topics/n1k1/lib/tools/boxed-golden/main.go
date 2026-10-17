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
	"github.com/couchbase/n1k1/engine"
	"github.com/couchbase/query/algebra"
	"github.com/couchbase/query/expression"
	"github.com/couchbase/query/parser/n1ql"
	"github.com/couchbase/query/value"
	cbqutil "github.com/couchbase/query/util"
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
	json.NewEncoder(os.Stdout).Encode(map[string]interface{}{"expr": "200 < orders.total", "rows": rows, "group": groupBy(files), "order": orderBy(files), "join": joinHash(files)})
}

func round(x float64) float64 { return math.Round(x) }

// (amortized costs, which can wobble by a byte from run to run: to the
// nearest 10)
func round10(x float64) float64 { return math.Round(x/10) * 10 }

// ---- GROUP BY: SELECT customer, SUM(total), COUNT(*) ... GROUP BY customer

// cbq's steps for a row, as its execution/groupby_initial.go and
// groupby_util.go's groupKey take them: the group key (each key
// evaluated, boxed into a map, marshaled to a string); then each
// aggregate's CumulateInitial, whose result replaces the group's last.
var gctx = glue.NewGlueContext(time.Unix(0, 0))
var gaggs []algebra.Aggregate
var gkeys expression.Expressions
var ggroups map[string]value.AnnotatedValue

//go:noinline
func cbqKey(item value.AnnotatedValue) string {
	kvs := map[string]interface{}{}
	for i, k := range gkeys {
		v, _ := k.Evaluate(item, gctx)
		if v.Type() != value.MISSING {
			kvs[fmt.Sprint(i)] = v
		}
	}
	b, _ := value.NewValue(kvs).MarshalJSON()
	return string(b)
}

//go:noinline
func cbqSum(item value.AnnotatedValue, m map[string]value.Value) {
	a := gaggs[0]
	v, _ := a.CumulateInitial(item, m[a.String()], gctx)
	m[a.String()] = v
}

//go:noinline
func cbqCount(item value.AnnotatedValue, m map[string]value.Value) {
	a := gaggs[1]
	v, _ := a.CumulateInitial(item, m[a.String()], gctx)
	m[a.String()] = v
}

func cbqGroup(item value.AnnotatedValue) {
	gk := cbqKey(item)
	gv := ggroups[gk]
	if gv == nil {
		gv = item
		ggroups[gk] = gv
		m := map[string]value.Value{}
		for _, a := range gaggs {
			m[a.String()], _ = a.Default(nil, gctx)
		}
		gv.SetAttachment(value.ATT_AGGREGATES, m)
	}
	m := gv.GetAttachment(value.ATT_AGGREGATES).(map[string]value.Value)
	cbqSum(item, m)
	cbqCount(item, m)
}

//go:noinline
func boxRow(r base.Vals) value.AnnotatedValue {
	v, _ := cv.Convert(r)
	av, ok := v.(value.AnnotatedValue)
	if !ok {
		av = value.NewAnnotatedValue(v)
	}
	return av
}

type gstep struct {
	Customer string ` + "`json:\"customer\"`" + `
	Total    string ` + "`json:\"total\"`" + `
	Sum      string ` + "`json:\"sum\"`" + `
	Count    string ` + "`json:\"count\"`" + `
	SumHex   string ` + "`json:\"sumHex\"`" + `
	CountHex string ` + "`json:\"countHex\"`" + `
}

func groupBy(files []string) map[string]interface{} {
	cv, _ = glue.NewConvertVals(labels)
	gkeys = expression.Expressions{expression.NewField(expression.NewIdentifier("orders"), expression.NewFieldName("customer", false))}
	gaggs = nil
	for _, t := range []string{"sum(orders.total)", "count(*)"} {
		e, err := n1ql.ParseExpression(t)
		if err != nil {
			panic(err)
		}
		gaggs = append(gaggs, e.(algebra.Aggregate))
	}
	var rows []base.Vals
	var data strings.Builder
	data.WriteString("\n")
	for _, f := range files {
		b, _ := os.ReadFile(f)
		b = bytes.TrimSpace(b)
		rows = append(rows, base.Vals{b, []byte(fmt.Sprintf("%q", strings.TrimSuffix(filepath.Base(f), ".json")))})
		data.Write(b)
		data.WriteString("\n")
	}
	// cbq: per row, once the groups exist (steady state), by stage
	ggroups = map[string]value.AnnotatedValue{}
	for _, r := range rows {
		cbqGroup(boxRow(r))
	}
	// (the groups, after one pass)
	var cbqOut []string
	for k, g := range ggroups {
		m := g.GetAttachment(value.ATT_AGGREGATES).(map[string]value.Value)
		cbqOut = append(cbqOut, fmt.Sprintf("%s sum=%v %T count=%v %T", k, m[gaggs[0].String()], m[gaggs[0].String()], m[gaggs[1].String()], m[gaggs[1].String()]))
	}
	sort.Strings(cbqOut)
	boxed := make([]value.AnnotatedValue, len(rows))
	stages := map[string][2]float64{}
	const M = 200
	runtime.MemProfileRate = 1
	before := groupProfile()
	for k := 0; k < M; k++ {
		for i, r := range rows {
			boxed[i] = boxRow(r)
		}
		for _, b := range boxed {
			cbqGroup(b)
		}
	}
	runtime.GC()
	after := groupProfile()
	runtime.MemProfileRate = 512 * 1024
	var perRow, perRowBytes float64
	for k, a := range after {
		n, by := float64(a[0]-before[k][0])/M/float64(len(rows)), float64(a[1]-before[k][1])/M/float64(len(rows))
		stages[k] = [2]float64{n, by}
		if k != "box" {
			perRow += n
			perRowBytes += by
		}
	}
	var breakdown []map[string]interface{}
	for _, k := range []string{"key", "sum", "count", "group"} {
		breakdown = append(breakdown, map[string]interface{}{"stage": k, "count": math.Round(stages[k][0]*10) / 10, "bytes": round10(stages[k][1])})
	}
	// n1k1: its group op, over the rows as inline data; allocations per
	// row, from 20 rows vs 1,000
	op := func(times int) *base.Op {
		return &base.Op{Kind: "group", Labels: base.Labels{` + "`" + `.["orders","customer"]` + "`" + `, "^aggregates|sum", "^aggregates|count"},
			Params: []interface{}{
				[]interface{}{[]interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "customer"}},
				[]interface{}{[]interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "total"}, []interface{}{"json", "true"}},
				[]interface{}{[]interface{}{"sum"}, []interface{}{"count"}},
			},
			Children: []*base.Op{{Kind: "scan", Labels: base.Labels{` + "`" + `.["orders"]` + "`" + `}, Params: []interface{}{"jsonsData", strings.Repeat(data.String(), times)}}}}
	}
	var out []string
	exec := func(o *base.Op, keep bool) {
		vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-boxed-golden-group")}
		engine.ExecOp(o, vars, func(v base.Vals) {
			if keep {
				var r []string
				for _, x := range v {
					r = append(r, string(x))
				}
				out = append(out, strings.Join(r, " "))
			}
		}, func(err error) {
			if err != nil {
				panic(err)
			}
		}, "", "")
	}
	exec(op(1), true)
	sort.Strings(out)
	o1, o50 := op(1), op(50)
	a1 := testing.AllocsPerRun(20, func() { exec(o1, false) })
	a50 := testing.AllocsPerRun(20, func() { exec(o50, false) })
	// n1k1's state per group, row by row: SUM's 8 bytes (a float64) and
	// COUNT's 8 (a uint64), as base.AggSum and base.AggCount fold them
	var steps []gstep
	state := map[string][2][]byte{}
	vc := base.NewValComparer()
	for _, r := range rows {
		c, _ := base.ValPathGet(r[0], []string{"customer"}, nil)
		t, _ := base.ValPathGet(r[0], []string{"total"}, nil)
		st, ok := state[string(c)]
		if !ok {
			st = [2][]byte{base.AggSum.Init(nil, nil), base.AggCount.Init(nil, nil)}
		}
		s1, _, _ := base.AggSum.Update(nil, t, nil, st[0], vc)
		c1, _, _ := base.AggCount.Update(nil, base.Val("true"), nil, st[1], vc)
		state[string(c)] = [2][]byte{s1, c1}
		sv, _, _ := base.AggSum.Result(nil, s1, nil)
		cnt, _, _ := base.AggCount.Result(nil, c1, nil)
		steps = append(steps, gstep{string(c), string(t), string(sv), string(cnt), fmt.Sprintf("% x", s1), fmt.Sprintf("% x", c1)})
	}
	return map[string]interface{}{
		"cbqPerRow": math.Round(perRow*10) / 10, "cbqPerRowBytes": round10(perRowBytes), "cbqBoxPerRow": math.Round(stages["box"][0]*10) / 10,
		"cbqStages": breakdown, "cbqGroups": cbqOut,
		"n1k1Setup": a1, "n1k1PerRow": math.Max(0, math.Round((a50-a1)/float64(49*len(rows))*100)/100), "n1k1Groups": out,
		"steps": steps,
	}
}

// ---- ORDER BY total DESC, and the hash JOIN of orders and customers

// docs: the order (or customer) files' docs, and their ids
func docs(files []string) (rows []base.Vals, data string) {
	var b strings.Builder
	b.WriteString("\n")
	for _, f := range files {
		x, _ := os.ReadFile(f)
		x = bytes.TrimSpace(x)
		rows = append(rows, base.Vals{x, []byte(fmt.Sprintf("%q", strings.TrimSuffix(filepath.Base(f), ".json")))})
		b.Write(x)
		b.WriteString("\n")
	}
	return rows, b.String()
}

// n1k1's allocations for an op over its data, once (setup and all), and
// per row: from the data once, and 50 times over
func n1k1Cost(mk func(times int) *base.Op, rows int) (float64, float64) {
	exec := func(o *base.Op) {
		vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-boxed-golden-op")}
		engine.ExecOp(o, vars, func(base.Vals) {}, func(err error) {
			if err != nil {
				panic(err)
			}
		}, "", "")
	}
	o1, o50 := mk(1), mk(50)
	a1 := testing.AllocsPerRun(20, func() { exec(o1) })
	a50 := testing.AllocsPerRun(20, func() { exec(o50) })
	return a1, math.Max(0, math.Round((a50-a1)/float64(49*rows)*100)/100)
}

// profiled: the allocations of f, by which of the named stage funcs
// they happened in, per unit (n units per run, M runs)
func profiled(stages []string, M, n int, f func()) []map[string]interface{} {
	runtime.MemProfileRate = 1
	before := stageProfile(stages)
	for k := 0; k < M; k++ {
		f()
	}
	runtime.GC()
	after := stageProfile(stages)
	runtime.MemProfileRate = 512 * 1024
	var out []map[string]interface{}
	for _, st := range stages {
		a, b := after[st], before[st]
		out = append(out, map[string]interface{}{"stage": strings.TrimPrefix(st, "main.cbq"),
			"count": math.Round(float64(a[0]-b[0])/float64(M*n)*10) / 10, "bytes": round10(float64(a[1]-b[1]) / float64(M*n))})
	}
	return out
}

func stageProfile(stages []string) map[string][2]int64 {
	runtime.GC()
	n, _ := runtime.MemProfile(nil, true)
	recs := make([]runtime.MemProfileRecord, n+100)
	n, _ = runtime.MemProfile(recs, true)
	out := map[string][2]int64{}
	for _, r := range recs[:n] {
		fr := runtime.CallersFrames(r.Stack())
		var fs []string
		for {
			f, more := fr.Next()
			fs = append(fs, f.Function)
			if !more {
				break
			}
		}
		all := strings.Join(fs, " ")
		for _, st := range stages {
			if strings.Contains(all, st+" ") || strings.HasSuffix(all, st) {
				x := out[st]
				x[0] += r.AllocObjects
				x[1] += r.AllocBytes
				out[st] = x
				break
			}
		}
	}
	return out
}

var octx = glue.NewGlueContext(time.Unix(0, 0))
var oterm = expression.NewField(expression.NewIdentifier("orders"), expression.NewFieldName("total", false))

// cbq's sort key for a row: evaluated, copied, kept on the row (as its
// getOriginalCachedValue does)
//
//go:noinline
func cbqSortKey(item value.AnnotatedValue) {
	rv, _ := oterm.Evaluate(item.Original(), octx)
	item.SetAttachment(0, rv.CopyForUpdate())
}

// cbq's compare: the two rows' kept keys, collated (as its lessThan does)
//
//go:noinline
func cbqSortCompare(a, b value.AnnotatedValue) bool {
	ka, _ := a.GetAttachment(0).(value.Value)
	kb, _ := b.GetAttachment(0).(value.Value)
	return ka.Collate(kb) > 0 // DESC
}

func orderBy(files []string) map[string]interface{} {
	rows, data := docs(files)
	cv, _ = glue.NewConvertVals(labels)
	items := make([]value.AnnotatedValue, len(rows))
	run := func() {
		for i, r := range rows {
			items[i] = boxRow(r)
		}
		for _, it := range items {
			cbqSortKey(it)
		}
		sort.SliceStable(items, func(i, j int) bool { return cbqSortCompare(items[i], items[j]) })
	}
	stages := profiled([]string{"main.cbqSortKey", "main.cbqSortCompare"}, 200, len(rows), run)
	var sorted []string
	run()
	for _, it := range items {
		k, _ := it.GetAttachment(0).(value.Value)
		sorted = append(sorted, fmt.Sprint(k))
	}
	mk := func(times int) *base.Op {
		return &base.Op{Kind: "order-offset-limit", Labels: base.Labels{` + "`" + `.["orders"]` + "`" + `},
			Params: []interface{}{
				[]interface{}{[]interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "total"}},
				[]interface{}{"desc"},
			},
			Children: []*base.Op{{Kind: "scan", Labels: base.Labels{` + "`" + `.["orders"]` + "`" + `}, Params: []interface{}{"jsonsData", strings.Repeat(data, times)}}}}
	}
	setup, perRow := n1k1Cost(mk, len(rows))
	// (n1k1's per-row allocation, and where: the push onto its heap)
	o50 := mk(50)
	runtime.MemProfileRate = 1
	before := pushProfile()
	for k := 0; k < 5; k++ {
		vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-boxed-golden-order")}
		engine.ExecOp(o50, vars, func(base.Vals) {}, func(error) {}, "", "")
	}
	runtime.GC()
	after := pushProfile()
	runtime.MemProfileRate = 512 * 1024
	pushN, pushB := float64(after[0]-before[0])/float64(5*50*len(rows)), float64(after[1]-before[1])/float64(5*50*len(rows))
	return map[string]interface{}{"cbqStages": stages, "cbqSorted": sorted, "n1k1Setup": setup, "n1k1PerRow": perRow,
		"n1k1PushAllocs": math.Round(pushN*100) / 100, "n1k1PushBytes": math.Round(pushB)}
}

// the allocations made right in the order op's per-row func (its push
// onto the heap): the first frame on their stacks
func pushProfile() [2]int64 {
	runtime.GC()
	n, _ := runtime.MemProfile(nil, true)
	recs := make([]runtime.MemProfileRecord, n+100)
	n, _ = runtime.MemProfile(recs, true)
	var out [2]int64
	for _, r := range recs[:n] {
		f, _ := runtime.CallersFrames(r.Stack()).Next()
		if f.Function == "github.com/couchbase/n1k1/engine.OpOrderOffsetLimit.func1" {
			out[0] += r.AllocObjects
			out[1] += r.AllocBytes
		}
	}
	return out
}

var jctx = glue.NewGlueContext(time.Unix(0, 0))
var jbuild = expression.NewField(expression.NewIdentifier("o"), expression.NewFieldName("customer", false))
var jprobe = expression.NewField(expression.NewIdentifier("c"), expression.NewFieldName("id", false))
var jon = expression.NewEq(jbuild, jprobe)
var jtab *cbqutil.HashTable

// cbq's hash join, its steps: a build row's key evaluated, and put in
// its hash table (marshaled to JSON, to hash it); a probe row's key
// evaluated, and looked up; and each match joined (as processAnsiExec
// does: the probe row copied, the build side set into it, the ON
// clause evaluated)
//
//go:noinline
func cbqBuild(item value.AnnotatedValue) {
	k, _ := jbuild.Evaluate(item, jctx)
	if err := jtab.Put(k, item, value.MarshalValue, value.EqualValueMissingNull, 0); err != nil {
		panic(err)
	}
}

//go:noinline
func cbqProbe(item value.AnnotatedValue) []value.AnnotatedValue {
	k, _ := jprobe.Evaluate(item, jctx)
	var out []value.AnnotatedValue
	v, err := jtab.Get(k, value.MarshalValue, value.EqualValue)
	for err == nil && v != nil {
		out = append(out, v.(value.AnnotatedValue))
		v, err = jtab.GetNext()
	}
	return out
}

//go:noinline
func cbqJoined(item, right value.AnnotatedValue) bool {
	joined := item.Copy().(value.AnnotatedValue)
	val, _ := right.Field("o")
	joined.SetField("o", val)
	r, _ := jon.Evaluate(joined, jctx)
	return r.Truth()
}

func joinHash(files []string) map[string]interface{} {
	orders, odata := docs(files)
	cfiles, _ := filepath.Glob(filepath.Join(filepath.Dir(files[0]), "../customers/*.json"))
	sort.Strings(cfiles)
	customers, cdata := docs(cfiles)
	ocv, _ := glue.NewConvertVals(base.Labels{` + "`" + `.["o"]` + "`" + `, "^id"})
	ccv, _ := glue.NewConvertVals(base.Labels{` + "`" + `.["c"]` + "`" + `, "^id"})
	box := func(c *glue.ConvertVals, r base.Vals) value.AnnotatedValue {
		v, _ := c.Convert(r)
		av, ok := v.(value.AnnotatedValue)
		if !ok {
			av = value.NewAnnotatedValue(v)
		}
		return av
	}
	ob := make([]value.AnnotatedValue, len(orders))
	cb := make([]value.AnnotatedValue, len(customers))
	matches := 0
	run := func() {
		for i, r := range orders {
			ob[i] = box(ocv, r)
		}
		for i, r := range customers {
			cb[i] = box(ccv, r)
		}
		jtab = cbqutil.NewHashTable(cbqutil.HASH_TABLE_FOR_HASH_JOIN, float64(len(orders)), 1)
		for _, it := range ob {
			cbqBuild(it)
		}
		matches = 0
		for _, it := range cb {
			for _, m := range cbqProbe(it) {
				if cbqJoined(it, m) {
					matches++
				}
			}
		}
	}
	const M = 100
	runtime.MemProfileRate = 1
	stages := []string{"main.cbqBuild", "main.cbqProbe", "main.cbqJoined"}
	before := stageProfile(stages)
	for k := 0; k < M; k++ {
		run()
	}
	runtime.GC()
	after := stageProfile(stages)
	runtime.MemProfileRate = 512 * 1024
	per := map[string]float64{"main.cbqBuild": float64(len(orders)), "main.cbqProbe": float64(len(customers)), "main.cbqJoined": float64(matches)}
	var out []map[string]interface{}
	for _, st := range stages {
		a, b := after[st], before[st]
		out = append(out, map[string]interface{}{"stage": strings.TrimPrefix(st, "main.cbq"), "per": per[st],
			"count": math.Round(float64(a[0]-b[0])/M/per[st]*10) / 10, "bytes": round10(float64(a[1]-b[1]) / M / per[st])})
	}
	mk := func(times int) *base.Op {
		return &base.Op{Kind: "joinHash-inner", Labels: base.Labels{` + "`" + `.["o"]` + "`" + `, ` + "`" + `.["c"]` + "`" + `},
			Params: []interface{}{
				[]interface{}{"labelPath", ` + "`" + `.["o"]` + "`" + `, "customer"},
				[]interface{}{"labelPath", ` + "`" + `.["c"]` + "`" + `, "id"},
			},
			Children: []*base.Op{
				{Kind: "scan", Labels: base.Labels{` + "`" + `.["o"]` + "`" + `}, Params: []interface{}{"jsonsData", strings.Repeat(odata, times)}},
				{Kind: "scan", Labels: base.Labels{` + "`" + `.["c"]` + "`" + `}, Params: []interface{}{"jsonsData", cdata}},
			}}
	}
	var joined int
	vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-boxed-golden-join")}
	engine.ExecOp(mk(1), vars, func(base.Vals) { joined++ }, func(err error) {
		if err != nil {
			panic(err)
		}
	}, "", "")
	setup, perRow := n1k1Cost(mk, len(orders))
	return map[string]interface{}{"cbqStages": out, "cbqMatches": matches, "n1k1Joined": joined, "n1k1Setup": setup, "n1k1PerRow": perRow,
		"build": len(orders), "probe": len(customers)}
}

// the GROUP BY's allocations, by stage, from the frames on their stacks
func groupProfile() map[string][2]int64 {
	runtime.GC()
	n, _ := runtime.MemProfile(nil, true)
	recs := make([]runtime.MemProfileRecord, n+100)
	n, _ = runtime.MemProfile(recs, true)
	out := map[string][2]int64{}
	for _, r := range recs[:n] {
		fr := runtime.CallersFrames(r.Stack())
		var fs []string
		for {
			f, more := fr.Next()
			fs = append(fs, f.Function)
			if !more {
				break
			}
		}
		all := strings.Join(fs, " ")
		var k string
		switch {
		case strings.Contains(all, "main.boxRow"):
			k = "box"
		case strings.Contains(all, "main.cbqKey"):
			k = "key"
		case strings.Contains(all, "main.cbqSum"):
			k = "sum"
		case strings.Contains(all, "main.cbqCount"):
			k = "count"
		case strings.Contains(all, "main.cbqGroup"):
			k = "group"
		default:
			continue
		}
		x := out[k]
		x[0] += r.AllocObjects
		x[1] += r.AllocBytes
		out[k] = x
	}
	return out
}

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
