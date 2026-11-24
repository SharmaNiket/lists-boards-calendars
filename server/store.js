// A small document store on SQLite (Node's built-in driver, so the Pi needs
// no native build). Every document carries a revision number; clients ask for
// "everything since revision N", which is what keeps several windows, and
// later a phone, in step.

import { DatabaseSync } from 'node:sqlite';

export const COLLECTIONS = ['settings', 'domains', 'sections', 'blocks', 'rules', 'tasks', 'comments', 'labels', 'filters', 'timeblocks', 'series', 'occs', 'plans'];

export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id));
      CREATE INDEX IF NOT EXISTS docs_rev ON docs (rev);
      CREATE TABLE IF NOT EXISTS gone (coll TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS gone_rev ON gone (rev);
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL, taskId TEXT, text TEXT);
    `);
    this.maps = new Map(COLLECTIONS.map((c) => [c, new Map()]));
    this.rev = 0;
    for (const row of this.db.prepare('SELECT coll, id, rev, data FROM docs').all()) {
      const doc = JSON.parse(row.data);
      doc._rev = row.rev;
      if (!this.maps.has(row.coll)) this.maps.set(row.coll, new Map());
      this.maps.get(row.coll).set(row.id, doc);
      if (row.rev > this.rev) this.rev = row.rev;
    }
    const g = this.db.prepare('SELECT MAX(rev) AS r FROM gone').get();
    if (g && g.r > this.rev) this.rev = g.r;
    this._put = this.db.prepare('INSERT INTO docs (coll, id, rev, data) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET rev = excluded.rev, data = excluded.data');
    this._del = this.db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?');
    this._gone = this.db.prepare('INSERT INTO gone (coll, id, rev) VALUES (?, ?, ?)');
    this._act = this.db.prepare('INSERT INTO activity (at, type, taskId, text) VALUES (?, ?, ?, ?)');
    this.depth = 0;
  }

  all(coll) {
    return [...this.maps.get(coll).values()];
  }
  get(coll, id) {
    return this.maps.get(coll).get(id) || null;
  }
  put(coll, doc) {
    if (!doc.id) throw new Error('document needs an id');
    doc._rev = ++this.rev;
    this.maps.get(coll).set(doc.id, doc);
    const { _rev, ...data } = doc;
    this._put.run(coll, doc.id, _rev, JSON.stringify(data));
    return doc;
  }
  del(coll, id) {
    if (!this.maps.get(coll).has(id)) return;
    this.maps.get(coll).delete(id);
    this._del.run(coll, id);
    this._gone.run(coll, id, ++this.rev);
  }
  log(type, taskId, text) {
    this._act.run(Date.now(), type, taskId || null, text || '');
  }
  activity(limit = 200) {
    return this.db.prepare('SELECT id, at, type, taskId, text FROM activity ORDER BY id DESC LIMIT ?').all(limit);
  }

  // Runs fn inside one transaction; nested calls join the outer one.
  tx(fn) {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      this.reload();
      throw err;
    } finally {
      this.depth--;
    }
  }
  reload() {
    for (const m of this.maps.values()) m.clear();
    for (const row of this.db.prepare('SELECT coll, id, rev, data FROM docs').all()) {
      const doc = JSON.parse(row.data);
      doc._rev = row.rev;
      this.maps.get(row.coll)?.set(row.id, doc);
    }
  }

  // Everything that changed after revision `since`.
  since(since = 0) {
    const docs = {};
    for (const [coll, map] of this.maps) {
      const changed = [];
      for (const doc of map.values()) if (doc._rev > since) changed.push(doc);
      if (changed.length) docs[coll] = changed;
    }
    const gone = since > 0 ? this.db.prepare('SELECT coll, id FROM gone WHERE rev > ?').all(since) : [];
    return { rev: this.rev, docs, gone };
  }

  exportAll() {
    const out = { version: 1, exportedAt: new Date().toISOString(), collections: {} };
    for (const [coll, map] of this.maps) out.collections[coll] = [...map.values()].map(({ _rev, ...d }) => d);
    return out;
  }
  importAll(dump) {
    if (!dump || !dump.collections) throw new Error('not a backup file');
    this.tx(() => {
      for (const coll of COLLECTIONS) {
        for (const doc of this.all(coll)) this.del(coll, doc.id);
        for (const doc of dump.collections[coll] || []) this.put(coll, { ...doc });
      }
    });
  }
  close() {
    this.db.close();
  }
}
