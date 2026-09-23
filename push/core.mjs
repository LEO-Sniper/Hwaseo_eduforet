// A snapshot is trusted only after it has appeared on the published site.
export function validateSnapshot(data) {
  if (data?.status !== 'ready' || !Number.isFinite(Date.parse(data.updatedAt)) ||
      !Array.isArray(data.trades) || data.trades.length > 10000) throw new Error('Invalid snapshot');
  for (const t of data.trades) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || ![59,84,113,129,148].includes(t.group) ||
        !Number.isFinite(Number(t.area)) || Number(t.area) <= 0 ||
        !Number.isSafeInteger(t.price) || t.price <= 0 || typeof t.cancelled !== 'boolean') {
      throw new Error('Invalid trade');
    }
  }
  return data;
}
export function signature(t) {
  return JSON.stringify([t.date, Number(t.area), t.price, String(t.floor ?? ''), t.group]);
}
export function initDatabase(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS seen (signature TEXT PRIMARY KEY, count INTEGER NOT NULL, active INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS subscriptions (endpoint TEXT PRIMARY KEY, proof TEXT NOT NULL, created INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS deliveries (endpoint TEXT NOT NULL, batch TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(endpoint,batch))');
  sql.exec('CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(due)');
}
export function readMeta(sql, key) {
  return [...sql.exec('SELECT value FROM meta WHERE key=?',key)][0]?.value;
}
export function writeMeta(sql, key, value) {
  sql.exec('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);
}
export function applySnapshot(storage, data, now=Date.now()) {
  validateSnapshot(data);
  const sql=storage.sql, stamp=Date.parse(data.updatedAt);
  return storage.transactionSync(() => {
    const old=readMeta(sql,'updatedAt');
    if (old && stamp <= Date.parse(old)) return {newTrades:0, baseline:false};
    const counts=new Map();
    for (const t of data.trades) {
      const key=signature(t), item=counts.get(key)||{total:0,active:0};
      item.total++; if (!t.cancelled) item.active++; counts.set(key,item);
    }
    let newTrades=0;
    for (const [key,item] of counts) {
      const prior=[...sql.exec('SELECT count,active FROM seen WHERE signature=?',key)][0];
      const previous=prior?.count||0, previousActive=prior?.active||0;
      // Keep high-water counts even when a row disappears or is canceled.
      if (old) newTrades+=Math.min(Math.max(0,item.active-previousActive),Math.max(0,item.total-previous));
      sql.exec('INSERT INTO seen(signature,count,active) VALUES(?,?,?) ON CONFLICT(signature) DO UPDATE SET count=MAX(count,excluded.count),active=MAX(active,excluded.active)',key,item.total,item.active);
    }
    writeMeta(sql,'updatedAt',data.updatedAt);
    writeMeta(sql,'checkedAt',String(now));
    if (newTrades) {
      sql.exec('INSERT OR IGNORE INTO deliveries(endpoint,batch,due,created) SELECT endpoint,?,?,? FROM subscriptions',data.updatedAt,now,now);
    }
    return {newTrades,baseline:!old};
  });
}
export function addSubscription(storage, endpoint, proof, now=Date.now()) {
  const sql=storage.sql;
  return storage.transactionSync(() => {
    const old=[...sql.exec('SELECT proof FROM subscriptions WHERE endpoint=?',endpoint)][0];
    if (old && old.proof!==proof) throw new Error('Subscription mismatch');
    if (!old && [...sql.exec('SELECT COUNT(*) AS n FROM subscriptions')][0].n>=10000) throw new Error('Capacity reached');
    sql.exec('INSERT OR IGNORE INTO subscriptions(endpoint,proof,created) VALUES(?,?,?)',endpoint,proof,now);
  });
}
export function removeSubscription(storage, endpoint, proof) {
  const sql=storage.sql;
  return storage.transactionSync(() => {
    const old=[...sql.exec('SELECT proof FROM subscriptions WHERE endpoint=?',endpoint)][0];
    if (old && old.proof!==proof) throw new Error('Subscription mismatch');
    sql.exec('DELETE FROM subscriptions WHERE endpoint=?',endpoint);
    sql.exec('DELETE FROM deliveries WHERE endpoint=?',endpoint);
  });
}
export function deliveryResult(sql,row,status,now=Date.now()) {
  if (status===404 || status===410) {
    sql.exec('DELETE FROM subscriptions WHERE endpoint=?',row.endpoint);
    sql.exec('DELETE FROM deliveries WHERE endpoint=?',row.endpoint);
  } else if ((status>=200 && status<300) || row.attempts>=5 || now-row.created>86400000 ||
             (status>=400 && status<500 && ![401,403,408,429].includes(status))) {
    sql.exec('DELETE FROM deliveries WHERE endpoint=? AND batch=?',row.endpoint,row.batch);
  } else {
    sql.exec('UPDATE deliveries SET attempts=attempts+1,due=? WHERE endpoint=? AND batch=?',
      now+Math.min(3600000,60000*2**row.attempts),row.endpoint,row.batch);
  }
}
