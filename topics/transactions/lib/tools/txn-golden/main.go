// The transactions topic's golden tool: one real transaction, alice
// pays bob 30, run by gocbcore (the Go SDK's core, which runs the
// transaction protocol on the client) against CAVES, Couchbase's mock
// server. At each of gocbcore's test hooks, it snapshots what's on the
// server: each doc's body and its "txn" xattr, and the ATR's attempts.
//
// The mock is downloaded once, from gocaves' GitHub releases, into the
// repo's tmp/ (not committed). UUIDs, CASes and timestamps are renamed
// in order of appearance, so the output is the same every run.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
	_ "unsafe"

	gocbcore "github.com/couchbase/gocbcore/v10"
	"github.com/couchbase/gocbcore/v10/memd"
	cavescli "github.com/couchbaselabs/gocaves/client"
)

// gocbcore's ATR ids, one per vbucket: a transaction's ATR is the one
// for the vbucket of the first doc it changes
//
//go:linkname atrIDs github.com/couchbase/gocbcore/v10.transactionAtrIDList
var atrIDs []string

var (
	agent  *gocbcore.Agent
	keys   = []string{"alice", "bob"}
	seed   = map[string]string{"alice": `{"balance":100}`, "bob": `{"balance":50}`}
	atrKey string
)

// a doc's body, and one of its xattrs (nil if it has none, or the doc
// isn't there)
func lookup(key, xattr string) (body, x any) {
	ch := make(chan struct{})
	_, err := agent.LookupIn(gocbcore.LookupInOptions{
		Key: []byte(key),
		Ops: []gocbcore.SubDocOp{
			{Op: memd.SubDocOpGet, Flags: memd.SubdocFlagXattrPath, Path: xattr},
			{Op: memd.SubDocOpGetDoc, Path: ""},
		},
		Flags: memd.SubdocDocFlagAccessDeleted,
	}, func(r *gocbcore.LookupInResult, err error) {
		defer close(ch)
		if err != nil {
			return
		}
		if r.Ops[0].Err == nil {
			x = decode(r.Ops[0].Value)
		}
		if r.Ops[1].Err == nil {
			body = decode(r.Ops[1].Value)
		}
	})
	if err != nil {
		log.Fatal(err)
	}
	<-ch
	return body, x
}

// (a body that isn't JSON, like the ATR's, comes back as its bytes)
func decode(b []byte) (v any) {
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Sprintf("%q", b)
	}
	return v
}

type Doc struct {
	Body any `json:"body"`
	Txn  any `json:"txn"`
}

type Snap struct {
	At   string         `json:"at"`
	Docs map[string]Doc `json:"docs"`
	// the ATR's attempts (nil: no ATR doc yet)
	ATR any `json:"atr"`
}

var snaps []Snap

func take(at string) {
	s := Snap{At: at, Docs: map[string]Doc{}}
	for _, k := range keys {
		b, x := lookup(k, "txn")
		s.Docs[k] = Doc{b, x}
	}
	_, s.ATR = lookup(atrKey, "attempts")
	if b, _ := lookup(atrKey, "attempts"); b != nil && s.ATR == nil {
		s.ATR = map[string]any{}
	}
	snaps = append(snaps, s)
}

// The hooks: a snapshot at each. (Each runs off gocbcore's goroutine:
// a lookup from inside a hook would wait on the connection the hook
// was called from.)
type hooks struct {
	gocbcore.TransactionDefaultHooks
}

func snapThen(at string, cb func(error)) { go func() { take(at); cb(nil) }() }

func (h *hooks) BeforeATRPending(cb func(error))   { snapThen("BeforeATRPending", cb) }
func (h *hooks) AfterATRPending(cb func(error))    { snapThen("AfterATRPending", cb) }
func (h *hooks) BeforeATRCommit(cb func(error))    { snapThen("BeforeATRCommit", cb) }
func (h *hooks) AfterATRCommit(cb func(error))     { snapThen("AfterATRCommit", cb) }
func (h *hooks) AfterDocsCommitted(cb func(error)) { snapThen("AfterDocsCommitted", cb) }
func (h *hooks) BeforeATRComplete(cb func(error))  { snapThen("BeforeATRComplete", cb) }
func (h *hooks) AfterATRComplete(cb func(error))   { snapThen("AfterATRComplete", cb) }
func (h *hooks) BeforeStagedReplace(id []byte, cb func(error)) {
	snapThen("BeforeStagedReplace "+string(id), cb)
}
func (h *hooks) AfterStagedReplaceComplete(id []byte, cb func(error)) {
	snapThen("AfterStagedReplaceComplete "+string(id), cb)
}
func (h *hooks) BeforeDocCommitted(id []byte, cb func(error)) {
	snapThen("BeforeDocCommitted "+string(id), cb)
}
func (h *hooks) AfterDocCommitted(id []byte, cb func(error)) {
	snapThen("AfterDocCommitted "+string(id), cb)
}

// do runs one of gocbcore's async ops, and waits for its answer.
func do[T any](f func(cb func(T, error)) (gocbcore.PendingOp, error)) T {
	type r struct {
		v   T
		err error
	}
	ch := make(chan r, 1)
	if _, err := f(func(v T, err error) { ch <- r{v, err} }); err != nil {
		log.Fatal(err)
	}
	x := <-ch
	if x.err != nil {
		log.Fatal(x.err)
	}
	return x.v
}

// (the same, for the transaction's ops, which don't return a PendingOp)
func txnDo[T any](f func(cb func(T, error)) error) T {
	return do(func(cb func(T, error)) (gocbcore.PendingOp, error) { return nil, f(cb) })
}

// Renames what differs from run to run: UUIDs and hex CASes, in order
// of appearance, by what they name; and rounds the ATR's expiry (ms).
var (
	uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	hexRe  = regexp.MustCompile(`^0x[0-9a-f]{16}$`)
	names  = map[string]string{}
	counts = map[string]int{}
)

func rename(s, kind string) string {
	if n, ok := names[s]; ok {
		return n
	}
	counts[kind]++
	names[s] = fmt.Sprintf("%s-%d", kind, counts[kind])
	return names[s]
}

// (the kind of id, from the key it's under)
var kinds = map[string]string{"txn": "txn", "tid": "txn", "atmpt": "attempt", "op": "op", "CAS": "cas", "tst": "cas", "tsc": "cas"}

func normalize(v any, key string) any {
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		ks := make([]string, 0, len(x))
		for k := range x {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		for _, k := range ks {
			nk := k
			// (the ATR's attempts are keyed by the attempt's id)
			if uuidRe.MatchString(k) {
				nk = rename(k, "attempt")
			}
			out[nk] = normalize(x[k], k)
		}
		return out
	case []any:
		for i := range x {
			x[i] = normalize(x[i], key)
		}
		return x
	case string:
		if uuidRe.MatchString(x) || hexRe.MatchString(x) {
			kind := kinds[key]
			if kind == "" {
				kind = "id"
			}
			return rename(x, kind)
		}
		return x
	case float64:
		if key == "exp" {
			return math.Round(x/1000) * 1000
		}
		return x
	}
	return v
}

func main() {
	// (the mock, cached in the repo's tmp/)
	self, _ := os.Getwd()
	cache := filepath.Join(self, "../../../../../tmp/gocaves")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		log.Fatal(err)
	}
	os.Setenv("GOCB_MOCK_PATH", cache)
	m, err := cavescli.NewClient(cavescli.NewClientOptions{Version: "v0.0.1-79", Quiet: true})
	if err != nil {
		log.Fatal(err)
	}
	defer m.Shutdown()
	cl, err := m.CreateCluster("golden")
	if err != nil {
		log.Fatal(err)
	}
	cfg := gocbcore.AgentConfig{}
	if err := cfg.FromConnStr(cl.ConnStr); err != nil {
		log.Fatal(err)
	}
	cfg.BucketName = "default"
	cfg.SecurityConfig.Auth = gocbcore.PasswordAuthProvider{Username: "Administrator", Password: "password"}
	if agent, err = gocbcore.CreateAgent(&cfg); err != nil {
		log.Fatal(err)
	}
	do(func(cb func(*gocbcore.WaitUntilReadyResult, error)) (gocbcore.PendingOp, error) {
		return agent.WaitUntilReady(time.Now().Add(20*time.Second), gocbcore.WaitUntilReadyOptions{}, cb)
	})
	for _, k := range keys {
		do(func(cb func(*gocbcore.StoreResult, error)) (gocbcore.PendingOp, error) {
			return agent.Set(gocbcore.SetOptions{Key: []byte(k), Value: []byte(seed[k])}, cb)
		})
	}
	snap, err := agent.ConfigSnapshot()
	if err != nil {
		log.Fatal(err)
	}
	vbs := map[string]uint16{}
	for _, k := range keys {
		vbs[k], _ = snap.KeyToVbucket([]byte(k))
	}
	numVbs, _ := snap.NumVbuckets()
	atrKey = atrIDs[vbs["alice"]]

	tcfg := &gocbcore.TransactionsConfig{
		DurabilityLevel:     gocbcore.TransactionDurabilityLevelNone,
		BucketAgentProvider: func(string) (*gocbcore.Agent, string, error) { return agent, "", nil },
		ExpirationTime:      60 * time.Second,
	}
	tcfg.Internal.Hooks = &hooks{}
	txns, err := gocbcore.InitTransactions(tcfg)
	if err != nil {
		log.Fatal(err)
	}
	defer txns.Close()
	txn, err := txns.BeginTransaction(nil)
	if err != nil {
		log.Fatal(err)
	}
	if err := txn.NewAttempt(); err != nil {
		log.Fatal(err)
	}
	take("begun")

	// alice pays bob 30
	got := map[string]*gocbcore.TransactionGetResult{}
	for _, k := range keys {
		got[k] = txnDo(func(cb func(*gocbcore.TransactionGetResult, error)) error {
			return txn.Get(gocbcore.TransactionGetOptions{Agent: agent, Key: []byte(k)}, cb)
		})
		take("Got " + k)
	}
	values := map[string]string{"alice": `{"balance":70}`, "bob": `{"balance":80}`}
	for _, k := range keys {
		txnDo(func(cb func(*gocbcore.TransactionGetResult, error)) error {
			return txn.Replace(gocbcore.TransactionReplaceOptions{Document: got[k], Value: []byte(values[k])}, cb)
		})
	}
	attempt := txn.Attempt()
	txnDo(func(cb func(struct{}, error)) error { return txn.Commit(func(err error) { cb(struct{}{}, err) }) })
	take("Committed")

	for i := range snaps {
		for k, d := range snaps[i].Docs {
			snaps[i].Docs[k] = Doc{d.Body, normalize(d.Txn, "")}
		}
		snaps[i].ATR = normalize(snaps[i].ATR, "")
	}
	out := map[string]any{
		"gocbcore": gocbcore.Version(),
		"mock":     "gocaves v0.0.1-79",
		"vbuckets": numVbs,
		"atrIds":   len(atrIDs),
		"vb":       vbs,
		"atr":      atrKey,
		"atrUsed":  string(attempt.AtrID) == atrKey,
		"state":    fmt.Sprint(txn.Attempt().State),
		"seed":     seed,
		"values":   values,
		"snaps":    snaps,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		log.Fatal(err)
	}
}
