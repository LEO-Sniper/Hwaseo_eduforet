export function koreaDay(now=new Date()) { return new Date(now.getTime()+9*3600000).toISOString().slice(0,10); }
export function initDatabase(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS totals (id INTEGER PRIMARY KEY, total INTEGER NOT NULL)');
  sql.exec('INSERT OR IGNORE INTO totals VALUES (1, 0)');
  sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, count INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS seen (day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY(day, visitor))');
}
export function readCounts(sql, day) {
  return {day,total:[...sql.exec('SELECT total FROM totals WHERE id=1')][0].total,
    today:[...sql.exec('SELECT count FROM daily WHERE day=?',day)][0]?.count||0};
}
export function recordVisit(storage, visitor, now=new Date()) {
  const day=koreaDay(now),sql=storage.sql;
  return storage.transactionSync(()=>{
    sql.exec('DELETE FROM seen WHERE day <> ?',day);
    const exists=[...sql.exec('SELECT 1 AS found FROM seen WHERE day=? AND visitor=?',day,visitor)].length>0;
    if(!exists){
      sql.exec('INSERT INTO seen (day,visitor) VALUES (?,?)',day,visitor);
      sql.exec('UPDATE totals SET total=total+1 WHERE id=1');
      sql.exec('INSERT INTO daily (day,count) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET count=count+1',day);
    }
    return readCounts(sql,day);
  });
}
