import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel, Chan, Cond, Sem } from '../src/explainers/scorch-goroutines/sim/des.js';

test('unbuffered channel is a rendezvous', () => {
  const k = new Kernel();
  const ch = new Chan(k, 'c', 0);
  const log = [];
  k.spawn('sender', function* () {
    log.push(['send-start', k.now]);
    yield ch.send(42);
    log.push(['send-done', k.now]);
  });
  k.spawn('receiver', function* () {
    yield k.sleep(10);
    const r = yield ch.recv();
    log.push(['recv', k.now, r.value]);
  });
  k.runUntil(100);
  // both sides complete at t=10; their relative order is unspecified
  assert.deepEqual(log[0], ['send-start', 0]);
  assert.deepEqual(log.slice(1).sort(), [['recv', 10, 42], ['send-done', 10]]);
});

test('buffered channel blocks only when full', () => {
  const k = new Kernel();
  const ch = new Chan(k, 'c', 1);
  const times = [];
  k.spawn('sender', function* () {
    yield ch.send(1); times.push(k.now);
    yield ch.send(2); times.push(k.now);
  });
  k.spawn('receiver', function* () {
    yield k.sleep(5);
    yield ch.recv();
    yield ch.recv();
  });
  k.runUntil(100);
  assert.deepEqual(times, [0, 5]);
});

test('select with timeout and close', () => {
  const k = new Kernel();
  const ch = new Chan(k, 'c', 1);
  const got = [];
  k.spawn('p', function* () {
    let r = yield k.select([ch.recvCase(), k.timeoutCase(10)]);
    got.push([r.index, k.now]);
    r = yield k.select([ch.recvCase(), k.timeoutCase(10)]);
    got.push([r.index, k.now, r.ok]);
  });
  k.after(15, () => ch.close());
  k.runUntil(100);
  assert.deepEqual(got, [[1, 10], [0, 15, false]]);
});

test('select default is non-blocking', () => {
  const k = new Kernel();
  const ch = new Chan(k, 'c', 0);
  let r;
  k.spawn('p', function* () { r = yield k.select([ch.recvCase()], { default: true }); });
  k.runUntil(1);
  assert.equal(r.index, -1);
});

test('cond and semaphore', () => {
  const k = new Kernel();
  const c = new Cond(k, 'c');
  const s = new Sem(k, 's', 1);
  const done = [];
  for (const name of ['a', 'b']) {
    k.spawn(name, function* () {
      yield c.wait();
      yield s.acquire();
      yield k.work(10);
      s.release();
      done.push([name, k.now]);
    });
  }
  k.after(5, () => c.broadcast());
  k.runUntil(100);
  assert.deepEqual(done, [['a', 15], ['b', 25]]);
});

test('same seed, same random select choices', () => {
  const run = (seed) => {
    const k = new Kernel({ seed });
    const a = new Chan(k, 'a', 100), b = new Chan(k, 'b', 100);
    for (let i = 0; i < 50; i++) { a.trySend(i); b.trySend(i); }
    const picks = [];
    k.spawn('p', function* () {
      for (let i = 0; i < 50; i++) picks.push((yield k.select([a.recvCase(), b.recvCase()])).index);
    });
    k.runUntil(1);
    return picks.join('');
  };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
});
