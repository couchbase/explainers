// compile-golden runs n1k1's compiler for real, for the 02-compile
// explainer: on the plan of 01-query's filter and project (with its
// expressions lowered to native, as n1k1's glue lowers them), over the
// order files as inline data, so the whole plan can be compiled. It
// records:
//
//   - the interpreter's source: OpFilter, OpProject and the comparison,
//     from engine/*.go;
//   - the same functions as intermed_build translates them (run afresh,
//     into a temp dir);
//   - the Go the compiler (glue/emit.OpToLines) emits for the plan;
//   - the rows from the interpreter (engine.ExecOp), and from that
//     emitted Go, compiled and run.
//
// It builds two small programs in temp modules that use the n1k1
// checkout (from ../../../sources.yaml, or $EXPLAINERS_SRC_N1K1) by a
// replace directive; the checkout itself is never written to.
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

// The functions the explainer shows, by file.
var FUNCS = []struct{ File, Name string }{
	{"engine/op_filter.go", "OpFilter"},
	{"engine/op_project.go", "OpProject"},
	{"engine/op_project.go", "MakeProjectFunc"},
}

type fn struct {
	Name  string   `json:"name"`
	File  string   `json:"file"`
	Line  int      `json:"line"`
	Src   []string `json:"src"`
	Inter []string `json:"intermed"`
}

type out struct {
	Plan     json.RawMessage `json:"plan"`
	Funcs    []fn            `json:"funcs"`
	Emitted  []string        `json:"emitted"`
	Interp   []string        `json:"interpreted"`
	Compiled []string        `json:"compiled"`
}

func main() {
	src := os.Getenv("EXPLAINERS_SRC_N1K1")
	if src == "" {
		src = filepath.Join(os.Getenv("HOME"), "go/src/github.com/couchbase/n1k1")
	}
	tmp, err := os.MkdirTemp("", "n1k1-compile-golden")
	check(err)
	defer os.RemoveAll(tmp)

	// the order files, as the plan's inline data
	files, err := filepath.Glob(filepath.Join(src, "examples/shop/default/orders/*.json"))
	check(err)
	sort.Strings(files)
	var data strings.Builder
	data.WriteString("\n")
	for _, f := range files {
		b, err := os.ReadFile(f)
		check(err)
		data.Write(bytes.TrimSpace(b))
		data.WriteString("\n")
	}

	// intermed_build, afresh, into the temp dir
	inter := filepath.Join(tmp, "intermed")
	check(os.MkdirAll(inter, 0o755))
	ib := exec.Command("go", "run", "./cmd/intermed_build", "-sourceDir", "engine", "-outDir", inter)
	ib.Dir = src
	ib.Env = append(os.Environ(), "GOFLAGS=-mod=readonly", "GOPROXY=off")
	ib.Stdout, ib.Stderr = os.Stderr, nil
	check(ib.Run())
	interSrc := readAll(inter)

	o := out{}
	for _, f := range FUNCS {
		b, err := os.ReadFile(filepath.Join(src, f.File))
		check(err)
		line, body := funcOf(string(b), f.Name)
		_, ibody := funcOf(interSrc, f.Name)
		o.Funcs = append(o.Funcs, fn{f.Name, f.File, line, body, ibody})
	}

	// the compiler, and the interpreter, on the plan
	gen := module(tmp, "gen", src, strings.ReplaceAll(GEN, "DATA", fmt.Sprintf("%q", data.String())))
	var res struct {
		Plan    json.RawMessage
		Emitted []string
		Rows    []string
	}
	check(json.Unmarshal(run(gen), &res))
	o.Plan, o.Emitted, o.Interp = res.Plan, res.Emitted, res.Rows

	// the emitted Go, compiled and run
	prog := strings.Replace(RUN, "BODY", strings.Join(res.Emitted, ""), 1)
	for _, imp := range []string{"bufio", "strings"} {
		if !strings.Contains(res.Emitted[0]+strings.Join(res.Emitted, ""), imp+".") {
			prog = strings.Replace(prog, fmt.Sprintf("\t%q\n", imp), "", 1)
		}
	}
	compiled := module(tmp, "compiled", src, prog)
	check(json.Unmarshal(run(compiled), &o.Compiled))

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	enc.SetEscapeHTML(false)
	check(enc.Encode(o))
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

// A function's line number and lines, from `func Name(` to its closing
// brace at column 0.
func funcOf(s, name string) (int, []string) {
	lines := strings.Split(s, "\n")
	re := regexp.MustCompile(`^func ` + name + `\(`)
	for i, l := range lines {
		if re.MatchString(l) {
			for j := i; j < len(lines); j++ {
				if lines[j] == "}" {
					return i + 1, lines[i : j+1]
				}
			}
		}
	}
	check(fmt.Errorf("no func %s", name))
	return 0, nil
}

func readAll(dir string) string {
	ms, err := filepath.Glob(filepath.Join(dir, "*.go"))
	check(err)
	var b strings.Builder
	for _, m := range ms {
		x, err := os.ReadFile(m)
		check(err)
		b.Write(x)
	}
	return b.String()
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// The plan: 01-query's project and filter, their expressions native (a
// labelPath into the doc's register; the constant as JSON), over a scan
// of the order files' docs, inline.
const PLAN = `func plan() *base.Op {
	return &base.Op{
		Kind:   "project",
		Labels: base.Labels{` + "`" + `.["id"]` + "`" + `, ` + "`" + `.["customer"]` + "`" + `, ` + "`" + `.["total"]` + "`" + `},
		Params: []interface{}{
			[]interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "id"},
			[]interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "customer"},
			[]interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "total"},
		},
		Children: []*base.Op{{
			Kind:   "filter",
			Labels: base.Labels{` + "`" + `.["orders"]` + "`" + `},
			Params: []interface{}{"lt", []interface{}{"json", "200"}, []interface{}{"labelPath", ` + "`" + `.["orders"]` + "`" + `, "total"}},
			Children: []*base.Op{{
				Kind:   "scan",
				Labels: base.Labels{` + "`" + `.["orders"]` + "`" + `},
				Params: []interface{}{"jsonsData", DATA},
			}},
		}},
	}
}
`

const GEN = `//go:build n1ql

package main

import (
	"encoding/json"
	"os"
	"strings"

	"github.com/couchbase/n1k1/base"
	"github.com/couchbase/n1k1/engine"
	"github.com/couchbase/n1k1/glue/emit"
	"github.com/couchbase/n1k1/rt"
)

` + PLAN + `
func main() {
	pj, _ := json.Marshal(plan())
	lines := emit.OpToLines(plan())
	var rows []string
	vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-compile-golden-interp")}
	engine.ExecOp(plan(), vars, func(vals base.Vals) {
		var r []string
		for _, v := range vals {
			r = append(r, string(v))
		}
		rows = append(rows, strings.Join(r, " "))
	}, func(err error) {
		if err != nil {
			panic(err)
		}
	}, "", "")
	json.NewEncoder(os.Stdout).Encode(map[string]interface{}{"Plan": json.RawMessage(pj), "Emitted": lines, "Rows": rows})
}
`

const RUN = `//go:build n1ql

package main

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"

	"github.com/couchbase/n1k1/base"
	"github.com/couchbase/n1k1/rt"
)

var _ = strings.Join

// Run: the emitted Go, as is.
func Run(lzVars *base.Vars, lzYieldVals base.YieldVals, lzYieldErr base.YieldErr) {
BODY
}

func main() {
	var rows []string
	vars := &base.Vars{Temps: make([]interface{}, 16), Ctx: rt.NewSpillCtx(os.TempDir() + "/n1k1-compile-golden-run")}
	Run(vars, func(vals base.Vals) {
		var r []string
		for _, v := range vals {
			r = append(r, string(v))
		}
		rows = append(rows, strings.Join(r, " "))
	}, func(err error) {
		if err != nil {
			panic(err)
		}
	})
	json.NewEncoder(os.Stdout).Encode(rows)
	_ = bufio.NewScanner
}
`
