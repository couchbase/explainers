// The transactions topic's golden tool: real transactions, run by
// gocbcore (the Go SDK's core, which runs the transaction protocol on
// the client) against CAVES, Couchbase's mock server, each scenario on
// a fresh cluster. At gocbcore's test hooks, it snapshots what's on the
// server: each doc's body and its "txn" xattr, and the ATRs' attempts.
//
//   - life (01-life): alice pays bob 30, snapshotted at each hook.
//   - reads (02-during): the same transfer, paused at three moments;
//     at each, an auditor reads alice and bob, plainly and in a
//     transaction of its own.
//   - conflict (02-during): the transfer, paused with both docs staged;
//     meanwhile a second transaction, bob pays alice 5, tries to change
//     bob, waits, and retries.
//
// The mock is downloaded once, from gocaves' GitHub releases, into the
// repo's tmp/ (not committed). UUIDs, CASes and timestamps are renamed
// in order of appearance, so the output is the same every run.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
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
	mock   *cavescli.Client
	keys   = []string{"alice", "bob"}
	seed   = map[string]string{"alice": `{"balance":100}`, "bob": `{"balance":50}`}
	values = map[string]string{"alice": `{"balance":70}`, "bob": `{"balance":80}`}
)

// A cluster: a fresh one per scenario, with alice and bob seeded.
type Cluster struct {
	agent *gocbcore.Agent
	txns  *gocbcore.TransactionsManager
	vbs   map[string]uint16
	// the ATRs a snapshot looks at: those for alice's and bob's vbuckets
	atrs   []string
	numVbs int
}

func newCluster(id string) *Cluster {
	cl, err := mock.CreateCluster(id)
	if err != nil {
		log.Fatal(err)
	}
	cfg := gocbcore.AgentConfig{}
	if err := cfg.FromConnStr(cl.ConnStr); err != nil {
		log.Fatal(err)
	}
	cfg.BucketName = "default"
	cfg.SecurityConfig.Auth = gocbcore.PasswordAuthProvider{Username: "Administrator", Password: "password"}
	agent, err := gocbcore.CreateAgent(&cfg)
	if err != nil {
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
	c := &Cluster{agent: agent, vbs: map[string]uint16{}}
	snap, err := agent.ConfigSnapshot()
	if err != nil {
		log.Fatal(err)
	}
	c.numVbs, _ = snap.NumVbuckets()
	for _, k := range keys {
		c.vbs[k], _ = snap.KeyToVbucket([]byte(k))
		c.atrs = append(c.atrs, atrIDs[c.vbs[k]])
	}
	c.txns, err = gocbcore.InitTransactions(&gocbcore.TransactionsConfig{
		DurabilityLevel:     gocbcore.TransactionDurabilityLevelNone,
		BucketAgentProvider: func(string) (*gocbcore.Agent, string, error) { return agent, "", nil },
		ExpirationTime:      60 * time.Second,
	})
	if err != nil {
		log.Fatal(err)
	}
	return c
}

func (c *Cluster) close() {
	c.txns.Close()
	c.agent.Close()
}

// a doc's body, and one of its xattrs (nil if it has none, or the doc
// isn't there)
func (c *Cluster) lookup(key, xattr string) (body, x any) {
	body, x, _ = c.lookupCas(key, xattr)
	return body, x
}

// (and its CAS, as hex)
func (c *Cluster) lookupCas(key, xattr string) (body, x any, cas string) {
	ch := make(chan struct{})
	_, err := c.agent.LookupIn(gocbcore.LookupInOptions{
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
		cas = casHex(r.Cas)
	})
	if err != nil {
		log.Fatal(err)
	}
	<-ch
	return body, x, cas
}

func casHex(c gocbcore.Cas) string { return fmt.Sprintf("0x%016x", uint64(c)) }

// a plain read: the doc's body, as anyone outside a transaction sees it
func (c *Cluster) plainGet(key string) any {
	r := do(func(cb func(*gocbcore.GetResult, error)) (gocbcore.PendingOp, error) {
		return c.agent.Get(gocbcore.GetOptions{Key: []byte(key)}, cb)
	})
	return decode(r.Value)
}

// (a body that isn't JSON, like an ATR's, comes back as its bytes)
func decode(b []byte) (v any) {
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Sprintf("%q", b)
	}
	return v
}

type Doc struct {
	Body any    `json:"body"`
	Txn  any    `json:"txn"`
	Cas  string `json:"cas"`
}

// What's on the server: each doc, and each ATR's attempts (nil: no ATR
// doc yet)
type Server struct {
	Docs map[string]Doc `json:"docs"`
	ATRs map[string]any `json:"atrs"`
}

func (c *Cluster) server() Server {
	s := Server{Docs: map[string]Doc{}, ATRs: map[string]any{}}
	for _, k := range keys {
		b, x, cas := c.lookupCas(k, "txn")
		s.Docs[k] = Doc{b, x, cas}
	}
	for _, a := range c.atrs {
		b, x := c.lookup(a, "attempts")
		if b != nil && x == nil {
			x = map[string]any{}
		}
		s.ATRs[a] = x
	}
	return s
}

// An event in a scenario: what happened, what's on the server just
// then, and anything else seen.
type Event struct {
	At     string         `json:"at"`
	Server Server         `json:"server"`
	Seen   map[string]any `json:"seen,omitempty"`
}

// The hooks: each calls on(name) off gocbcore's goroutine (a lookup
// from inside a hook would wait on the connection the hook was called
// from), then lets the transaction go on.
type hooks struct {
	gocbcore.TransactionDefaultHooks
	on func(at string)
}

func (h *hooks) call(at string, cb func(error)) {
	go func() {
		if h.on != nil {
			h.on(at)
		}
		cb(nil)
	}()
}
func (h *hooks) BeforeATRPending(cb func(error))    { h.call("BeforeATRPending", cb) }
func (h *hooks) AfterATRPending(cb func(error))     { h.call("AfterATRPending", cb) }
func (h *hooks) BeforeATRCommit(cb func(error))     { h.call("BeforeATRCommit", cb) }
func (h *hooks) AfterATRCommit(cb func(error))      { h.call("AfterATRCommit", cb) }
func (h *hooks) AfterDocsCommitted(cb func(error))  { h.call("AfterDocsCommitted", cb) }
func (h *hooks) BeforeATRComplete(cb func(error))   { h.call("BeforeATRComplete", cb) }
func (h *hooks) AfterATRComplete(cb func(error))    { h.call("AfterATRComplete", cb) }
func (h *hooks) BeforeATRAborted(cb func(error))    { h.call("BeforeATRAborted", cb) }
func (h *hooks) AfterATRAborted(cb func(error))     { h.call("AfterATRAborted", cb) }
func (h *hooks) BeforeATRRolledBack(cb func(error)) { h.call("BeforeATRRolledBack", cb) }
func (h *hooks) AfterATRRolledBack(cb func(error))  { h.call("AfterATRRolledBack", cb) }
func (h *hooks) BeforeStagedReplace(id []byte, cb func(error)) {
	h.call("BeforeStagedReplace "+string(id), cb)
}
func (h *hooks) AfterStagedReplaceComplete(id []byte, cb func(error)) {
	h.call("AfterStagedReplaceComplete "+string(id), cb)
}
func (h *hooks) BeforeDocCommitted(id []byte, cb func(error)) {
	h.call("BeforeDocCommitted "+string(id), cb)
}
func (h *hooks) AfterDocCommitted(id []byte, cb func(error)) {
	h.call("AfterDocCommitted "+string(id), cb)
}
func (h *hooks) BeforeDocGet(id []byte, cb func(error)) { h.call("BeforeDocGet "+string(id), cb) }
func (h *hooks) AfterGetComplete(id []byte, cb func(error)) {
	h.call("AfterGetComplete "+string(id), cb)
}
func (h *hooks) BeforeCheckATREntryForBlockingDoc(id []byte, cb func(error)) {
	h.call("BeforeCheckATREntryForBlockingDoc "+string(id), cb)
}
func (h *hooks) BeforeDocRolledBack(id []byte, cb func(error)) {
	h.call("BeforeDocRolledBack "+string(id), cb)
}
func (h *hooks) HasExpiredClientSideHook(stage string, id []byte, cb func(bool, error)) {
	go func() {
		if h.on != nil {
			h.on("HasExpired " + stage + " " + string(id))
		}
		cb(false, nil)
	}()
}

// do runs one of gocbcore's async ops, and waits for its answer.
func do[T any](f func(cb func(T, error)) (gocbcore.PendingOp, error)) T {
	v, err := try(f)
	if err != nil {
		log.Fatal(err)
	}
	return v
}

// try is do, returning the op's error.
func try[T any](f func(cb func(T, error)) (gocbcore.PendingOp, error)) (T, error) {
	type r struct {
		v   T
		err error
	}
	ch := make(chan r, 1)
	if _, err := f(func(v T, err error) { ch <- r{v, err} }); err != nil {
		var zero T
		return zero, err
	}
	x := <-ch
	return x.v, x.err
}

// (the same, for the transaction's ops, which don't return a PendingOp)
func txnTry[T any](f func(cb func(T, error)) error) (T, error) {
	return try(func(cb func(T, error)) (gocbcore.PendingOp, error) { return nil, f(cb) })
}

func txnGet(c *Cluster, txn *gocbcore.Transaction, k string) (*gocbcore.TransactionGetResult, error) {
	return txnTry(func(cb func(*gocbcore.TransactionGetResult, error)) error {
		return txn.Get(gocbcore.TransactionGetOptions{Agent: c.agent, Key: []byte(k)}, cb)
	})
}

func txnReplace(txn *gocbcore.Transaction, d *gocbcore.TransactionGetResult, v string) error {
	_, err := txnTry(func(cb func(*gocbcore.TransactionGetResult, error)) error {
		return txn.Replace(gocbcore.TransactionReplaceOptions{Document: d, Value: []byte(v)}, cb)
	})
	return err
}

func txnCommit(txn *gocbcore.Transaction) error {
	_, err := txnTry(func(cb func(struct{}, error)) error { return txn.Commit(func(err error) { cb(struct{}{}, err) }) })
	return err
}

func txnRollback(txn *gocbcore.Transaction) error {
	_, err := txnTry(func(cb func(struct{}, error)) error { return txn.Rollback(func(err error) { cb(struct{}{}, err) }) })
	return err
}

// An attempt's outcome: its error, if any, and what gocbcore says to
// do about it.
type Attempt struct {
	Error    string `json:"error,omitempty"`
	Retry    bool   `json:"retry"`
	Rollback bool   `json:"rollback"`
}

// run runs a transaction as the SDKs do: an attempt runs body, then
// commits; if it fails, gocbcore's error says whether to roll the
// attempt back, and whether to try again with a new attempt.
func run(c *Cluster, h *hooks, body func(txn *gocbcore.Transaction) error) []Attempt {
	opts := &gocbcore.TransactionOptions{}
	opts.Internal.Hooks = h
	txn, err := c.txns.BeginTransaction(opts)
	if err != nil {
		log.Fatal(err)
	}
	var out []Attempt
	for len(out) < 5 {
		if err := txn.NewAttempt(); err != nil {
			log.Fatal(err)
		}
		err := body(txn)
		if err == nil {
			err = txnCommit(txn)
		}
		if err == nil {
			return append(out, Attempt{})
		}
		var tofe *gocbcore.TransactionOperationFailedError
		if !errors.As(err, &tofe) {
			log.Fatal(err)
		}
		a := Attempt{Error: errName(err), Retry: tofe.Retry(), Rollback: tofe.Rollback()}
		out = append(out, a)
		if a.Rollback {
			if err := txnRollback(txn); err != nil {
				log.Fatal(err)
			}
		}
		if !a.Retry {
			return out
		}
	}
	log.Fatal("too many attempts")
	return nil
}

// (an error's name, without the parts that differ from run to run)
func errName(err error) string {
	var tofe *gocbcore.TransactionOperationFailedError
	if errors.As(err, &tofe) {
		err = tofe.InternalUnwrap()
	}
	for _, e := range []error{gocbcore.ErrCasMismatch, gocbcore.ErrWriteWriteConflict, gocbcore.ErrDocumentNotFound} {
		if errors.Is(err, e) {
			return e.Error()
		}
	}
	return strings.SplitN(err.Error(), " |", 2)[0]
}

// ---------------------------------------------------------------------
// The scenarios

// life: alice pays bob 30, snapshotted at each hook (01-life).
func life() map[string]any {
	c := newCluster("life")
	defer c.close()
	type Snap struct {
		At   string         `json:"at"`
		Docs map[string]Doc `json:"docs"`
		ATR  any            `json:"atr"`
	}
	atr := c.atrs[0]
	var snaps []Snap
	take := func(at string) {
		s := c.server()
		snaps = append(snaps, Snap{at, s.Docs, s.ATRs[atr]})
	}
	h := &hooks{on: func(at string) {
		if !strings.HasPrefix(at, "HasExpired") && !strings.HasPrefix(at, "BeforeDocGet") && !strings.HasPrefix(at, "AfterGetComplete") {
			take(at)
		}
	}}
	take("begun")
	attempts := run(c, h, func(txn *gocbcore.Transaction) error {
		got := map[string]*gocbcore.TransactionGetResult{}
		for _, k := range keys {
			d, err := txnGet(c, txn, k)
			if err != nil {
				return err
			}
			got[k] = d
			take("Got " + k)
		}
		for _, k := range keys {
			if err := txnReplace(txn, got[k], values[k]); err != nil {
				return err
			}
		}
		return nil
	})
	take("Committed")
	n := newNames()
	for i := range snaps {
		for k, d := range snaps[i].Docs {
			snaps[i].Docs[k] = Doc{d.Body, n.normalize(d.Txn, ""), n.cas(d.Cas)}
		}
		snaps[i].ATR = n.normalize(snaps[i].ATR, "")
	}
	state := "completed"
	if len(attempts) != 1 || attempts[0].Error != "" {
		state = "failed"
	}
	return map[string]any{
		"vbuckets": c.numVbs,
		"atrIds":   len(atrIDs),
		"vb":       c.vbs,
		"atr":      atr,
		"state":    state,
		"seed":     seed,
		"values":   values,
		"snaps":    snaps,
	}
}

// transfer runs alice pays bob 30 as in life, calling pause(at) at
// each hook.
func transfer(c *Cluster, pause func(at string)) []Attempt {
	return run(c, &hooks{on: pause}, func(txn *gocbcore.Transaction) error {
		got := map[string]*gocbcore.TransactionGetResult{}
		for _, k := range keys {
			d, err := txnGet(c, txn, k)
			if err != nil {
				return err
			}
			got[k] = d
		}
		for _, k := range keys {
			if err := txnReplace(txn, got[k], values[k]); err != nil {
				return err
			}
		}
		return nil
	})
}

// reads: the transfer, paused at three moments; at each, an auditor
// reads alice and bob, plainly, and in a transaction of its own.
func reads() map[string]any {
	c := newCluster("reads")
	defer c.close()
	moments := map[string]string{
		"AfterStagedReplaceComplete bob": "staged",
		"AfterATRCommit":                 "committed",
		"AfterDocCommitted alice":        "half-unstaged",
	}
	var events []Event
	audit := func(moment string) {
		before := c.server()
		plain := map[string]any{}
		for _, k := range keys {
			plain[k] = c.plainGet(k)
		}
		// the auditor's transaction: it reads both, and changes nothing
		txnRead := map[string]any{}
		var atrChecks []string
		h := &hooks{on: func(at string) {
			if id, ok := strings.CutPrefix(at, "BeforeCheckATREntryForBlockingDoc "); ok {
				atrChecks = append(atrChecks, id)
			}
		}}
		attempts := run(c, h, func(txn *gocbcore.Transaction) error {
			for _, k := range keys {
				d, err := txnGet(c, txn, k)
				if err != nil {
					return err
				}
				txnRead[k] = decode(d.Value)
			}
			return nil
		})
		after := c.server()
		events = append(events, Event{At: moment, Server: before, Seen: map[string]any{
			"plain":    plain,
			"txn":      txnRead,
			"attempts": attempts,
			// (the auditor's reads write nothing)
			"wrote": !jsonEq(before, after),
			// (the docs whose ATR the auditor's reads looked up)
			"atrChecks": atrChecks,
		}})
	}
	attempts := transfer(c, func(at string) {
		if m, ok := moments[at]; ok {
			audit(m)
		}
	})
	n := newNames()
	for i := range events {
		events[i].Server = n.server(events[i].Server)
		events[i].Seen["attempts"] = n.normalize(events[i].Seen["attempts"], "")
	}
	return map[string]any{"events": events, "attempts": attempts, "atrs": c.atrs}
}

// conflict: the transfer, paused with both docs staged; meanwhile a
// second transaction, bob pays alice 5, tries to change bob.
func conflict() map[string]any {
	c := newCluster("conflict")
	defer c.close()
	var events []Event
	ev := func(at string, seen map[string]any) {
		events = append(events, Event{At: at, Server: c.server(), Seen: seen})
	}
	paused, release, t1Done := make(chan struct{}), make(chan struct{}), make(chan []Attempt, 1)
	go func() {
		t1Done <- transfer(c, func(at string) {
			switch {
			case at == "AfterStagedReplaceComplete bob":
				close(paused)
				<-release
			case at == "AfterATRCommit", at == "AfterATRComplete", strings.HasPrefix(at, "AfterDocCommitted"):
				// (T2 waits, in its poll, while T1 runs to the end)
				ev("t1 "+at, nil)
			}
		})
	}()
	<-paused
	ev("t1 paused", nil)

	// T2: bob pays alice 5. Its hooks note what it does; the second
	// time it polls bob's ATR, waiting for T1, T1 is let go, and runs to
	// the end.
	polls, attempt := 0, 0
	var t1 []Attempt
	t2Values := map[string]map[string]any{}
	h := &hooks{}
	h.on = func(at string) {
		switch {
		case strings.HasPrefix(at, "HasExpired writeWriteConflict"):
			polls++
			if polls == 2 {
				close(release)
				t1 = <-t1Done
				ev("t1 done", map[string]any{"attempts": t1})
			}
			ev(fmt.Sprintf("t2 poll %d", polls), nil)
		case at == "AfterATRPending", at == "AfterATRAborted", at == "AfterATRRolledBack", at == "AfterATRCommit",
			at == "AfterATRComplete", strings.HasPrefix(at, "AfterStagedReplaceComplete"), strings.HasPrefix(at, "AfterDocCommitted"):
			ev(fmt.Sprintf("t2 %s", at), nil)
		}
	}
	t2 := run(c, h, func(txn *gocbcore.Transaction) error {
		attempt++
		seen := map[string]any{}
		t2Values[fmt.Sprint(attempt)] = seen
		bob, err := txnGet(c, txn, "bob")
		if err != nil {
			return err
		}
		alice, err := txnGet(c, txn, "alice")
		if err != nil {
			return err
		}
		var b, a struct{ Balance int }
		json.Unmarshal(bob.Value, &b)
		json.Unmarshal(alice.Value, &a)
		seen["bob"], seen["alice"] = b.Balance, a.Balance
		ev(fmt.Sprintf("t2 attempt %d read", attempt), map[string]any{"bob": b.Balance, "alice": a.Balance, "cas": map[string]any{"bob": casHex(bob.Cas), "alice": casHex(alice.Cas)}})
		if err := txnReplace(txn, bob, fmt.Sprintf(`{"balance":%d}`, b.Balance-5)); err != nil {
			ev(fmt.Sprintf("t2 attempt %d failed", attempt), map[string]any{"error": errName(err)})
			return err
		}
		return txnReplace(txn, alice, fmt.Sprintf(`{"balance":%d}`, a.Balance+5))
	})
	ev("t2 done", map[string]any{"attempts": t2})
	n := newNames()
	for i := range events {
		events[i].Server = n.server(events[i].Server)
		if events[i].Seen != nil && events[i].Seen["attempts"] != nil {
			events[i].Seen["attempts"] = n.normalize(events[i].Seen["attempts"], "")
		}
		if events[i].Seen != nil && events[i].Seen["cas"] != nil {
			cas := events[i].Seen["cas"].(map[string]any)
			for _, k := range keys {
				cas[k] = n.cas(cas[k].(string))
			}
		}
	}
	return map[string]any{"events": events, "t1": t1, "t2": t2, "polls": polls, "atrs": c.atrs, "vb": c.vbs}
}

func jsonEq(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// ---------------------------------------------------------------------
// Renames what differs from run to run: UUIDs and hex CASes, in order
// of appearance, by what they name; and rounds the ATR's expiry (ms).

var (
	uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	hexRe  = regexp.MustCompile(`^0x[0-9a-f]{16}$`)
)

type names struct {
	names  map[string]string
	counts map[string]int
	// (docs' CASes, numbered on their own: cas-1, cas-2, ...)
	docCas *names
}

func newNames() *names {
	return &names{map[string]string{}, map[string]int{}, &names{map[string]string{}, map[string]int{}, nil}}
}

func (n *names) cas(s string) string { return n.docCas.rename(s, "cas") }

func (n *names) rename(s, kind string) string {
	if x, ok := n.names[s]; ok {
		return x
	}
	n.counts[kind]++
	n.names[s] = fmt.Sprintf("%s-%d", kind, n.counts[kind])
	return n.names[s]
}

// (the kind of id, from the key it's under)
var kinds = map[string]string{"txn": "txn", "tid": "txn", "atmpt": "attempt", "op": "op", "CAS": "cas", "tst": "cas", "tsc": "cas", "tsrs": "cas", "tsrc": "cas", "tsrb": "cas"}

func (n *names) server(s Server) Server {
	out := Server{Docs: map[string]Doc{}, ATRs: map[string]any{}}
	for _, k := range keys {
		out.Docs[k] = Doc{s.Docs[k].Body, n.normalize(s.Docs[k].Txn, ""), n.cas(s.Docs[k].Cas)}
	}
	ks := make([]string, 0, len(s.ATRs))
	for k := range s.ATRs {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		out.ATRs[k] = n.normalize(s.ATRs[k], "")
	}
	return out
}

func (n *names) normalize(v any, key string) any {
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
				nk = n.rename(k, "attempt")
			}
			out[nk] = n.normalize(x[k], k)
		}
		return out
	case []any:
		for i := range x {
			x[i] = n.normalize(x[i], key)
		}
		return x
	case []Attempt:
		return x
	case string:
		if uuidRe.MatchString(x) || hexRe.MatchString(x) {
			kind := kinds[key]
			if kind == "" {
				kind = "id"
			}
			return n.rename(x, kind)
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
	var err error
	if mock, err = cavescli.NewClient(cavescli.NewClientOptions{Version: "v0.0.1-79", Quiet: true}); err != nil {
		log.Fatal(err)
	}
	defer mock.Shutdown()

	out := life()
	out["gocbcore"] = gocbcore.Version()
	out["mock"] = "gocaves v0.0.1-79"
	out["reads"] = reads()
	out["conflict"] = conflict()
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		log.Fatal(err)
	}
}
