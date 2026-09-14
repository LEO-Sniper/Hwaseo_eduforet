'use strict';
const groups = [59, 84, 113, 129, 148];
const tints = ['#e7f0e6','#e5eee9','#edf0df','#f1eee1','#e8ece9'];
const $ = id => document.getElementById(id);
function kstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value = kind => parts.find(p=>p.type===kind).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function startDate(end) {
  const [y,m,d] = end.split('-').map(Number);
  const first = new Date(Date.UTC(y,m-4,1));
  const last = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,last));
  return first.toISOString().slice(0,10);
}
function money(n) {
  const eok = Math.floor(n/10000), rest = n%10000;
  return (eok ? `${eok}억` : '') + (rest ? `${eok?' ':''}${rest.toLocaleString('ko-KR')}만` : '') + '원';
}
function element(tag, text, cls) {
  const el = document.createElement(tag);
  if(text !== undefined) el.textContent = text;
  if(cls) el.className = cls;
  return el;
}
function cancelDate(value) {
  const digits = (value || '').replace(/\D/g,'');
  return digits.length===8 ? `${digits.slice(0,4)}.${digits.slice(4,6)}.${digits.slice(6)}` : value;
}
function renderDistribution(trades, ready) {
  const host=$('distribution-chart');host.replaceChildren();
  const active=trades.filter(t=>!t.cancelled && groups.includes(t.group) && Number.isFinite(t.price));
  $('chart-detail').textContent=!ready?'자료 연결 후 차트가 표시됩니다.':active.length?'점을 누르면 계약일·금액·층을 확인할 수 있습니다.':'이 기간 정상 거래없음 · 계약 해제 제외';
  const prices=active.map(t=>t.price);
  const low=prices.length?Math.min(...prices):0, high=prices.length?Math.max(...prices):0;
  const padding=Math.max((high-low)*0.15,1000);
  const min=Math.max(0,Math.floor((low-padding)/1000)*1000);
  const tickStep=Math.max(1000,Math.ceil((high+padding-min)/4/1000)*1000);
  const max=min+4*tickStep;
  const pos=price=>100*(price-min)/(max-min);
  host.append(element('p','가격 (억원)','chart-y-title'));
  const frame=element('div',undefined,'chart-frame');
  const plot=element('div',undefined,'chart-plot');
  for(let i=0;i<=4;i++){
    const grid=element('div',undefined,'chart-grid');grid.style.bottom=`${i*25}%`;
    grid.append(element('span',active.length?`${((min+tickStep*i)/10000).toFixed(1)}억`:'—','chart-y-tick'));
    plot.append(grid);
  }
  groups.forEach((group,index)=>{
    const rows=active.filter(t=>t.group===group);
    const column=element('div',undefined,'chart-column');column.style.left=`${index*20}%`;
    if(!rows.length)column.append(element('span',ready?'거래없음':'대기','chart-no-data'));
    else {
      const values=rows.map(t=>t.price), a=Math.min(...values), b=Math.max(...values);
      const range=element('div',undefined,'chart-range');range.style.bottom=`${pos(a)}%`;range.style.height=`${pos(b)-pos(a)}%`;column.append(range);
      const buckets=new Map();
      rows.forEach(t=>{if(!buckets.has(t.price))buckets.set(t.price,[]);buckets.get(t.price).push(t)});
      [...buckets].sort((a,b)=>a[0]-b[0]).forEach(([price,items],i)=>{
        const point=element('button',items.length>1?String(items.length):'','chart-point');point.type='button';
        point.style.bottom=`${pos(price)}%`;point.style.left=`calc(50% + ${buckets.size>1?(i%2?5:-5):0}px)`;
        point.setAttribute('aria-label',`전용 ${group}제곱미터 ${money(price)} ${items.length}건, 상세 보기`);
        point.addEventListener('click',()=>{
          const detail=items.map(t=>`${t.date.replaceAll('-','.')} · ${t.area}㎡ · ${t.floor===null?'층 미제공':t.floor+'층'}`).join(' / ');
          $('chart-detail').textContent=`${group}㎡ · ${money(price)} · ${items.length}건 — ${detail}`;
          $('chart-detail').scrollTop=0;
        });column.append(point);
      });
    }
    plot.append(column);
  });
  frame.append(plot);
  const axis=element('div',undefined,'chart-x-axis');
  groups.forEach(group=>{const label=element('div',`${group}㎡`);label.append(element('small',ready?`${active.filter(t=>t.group===group).length}건`:'대기'));axis.append(label)});
  frame.append(axis,element('p','전용면적 (㎡)','chart-x-title'));host.append(frame);
}
function newBadgeTrade(rows, now = new Date()) {
  const candidates = rows.filter(t=>!t.cancelled && t.firstSeenAt && Number.isFinite(Date.parse(t.firstSeenAt)) && Date.parse(t.firstSeenAt)<=now.getTime());
  candidates.sort((a,b)=>Date.parse(b.firstSeenAt)-Date.parse(a.firstSeenAt) || b.date.localeCompare(a.date) || b.price-a.price);
  const newest=candidates[0];
  if(!newest)return null;
  const first=kstDate(new Date(newest.firstSeenAt));
  const [year,month,day]=first.split('-').map(Number);
  const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const expiry=new Date(Date.UTC(year,month,Math.min(day,lastDay))).toISOString().slice(0,10);
  return kstDate(now)<expiry ? newest : null;
}
function render(data) {
  const end = kstDate(), start = startDate(end);
  $('period').textContent = `${start.replaceAll('-','.')} — ${end.replaceAll('-','.')}`;
  const ready = data.status==='ready';
  const trades = (data.trades || []).filter(t => start<=t.date && t.date<=end).sort((a,b)=>b.date.localeCompare(a.date));
  renderDistribution(trades, ready);
  $('cards').replaceChildren();
  groups.forEach((group,index)=>{
    const rows = trades.filter(t=>t.group===group), active=rows.filter(t=>!t.cancelled), cancelled=rows.length-active.length;
    const newest=newBadgeTrade(rows);
    const card=element('article',undefined,'card');card.style.setProperty('--tint',tints[index]);
    const head=element('div',undefined,'card-head'), top=element('div',undefined,'card-top');
    const title=element('h3',undefined,'area');title.append(element('small','전용 '),document.createTextNode(`${group}㎡`));
    const count=element('div',ready?`${active.length}건`:'확인 대기','count');
    if(cancelled)count.append(element('small',`해제 ${cancelled}건`));
    top.append(title,count);head.append(top);
    const prices=active.map(t=>t.price);
    head.append(element('p',!ready?'자료 연결 대기':prices.length ? (Math.min(...prices)===Math.max(...prices)?money(prices[0]):`${money(Math.min(...prices))} ~ ${money(Math.max(...prices))}`):'거래없음','range'));card.append(head);
    if(rows.length){
      const table=element('table');table.setAttribute('aria-label',`전용 ${group}제곱미터 매매 내역`);
      const tr=element('tr');['계약일','전용㎡','거래금액','층'].forEach(label=>{const th=element('th',label);th.scope='col';tr.append(th)});
      const thead=element('thead');thead.append(tr);table.append(thead);
      const tbody=element('tbody');
      rows.forEach(t=>{
        const r=element('tr',undefined,t.cancelled?'cancelled':'');
        [t.date.slice(5).replace('-','.'),t.area,money(t.price),t.floor===null?'—':`${t.floor}층`].forEach((value,i)=>{
          const td=element('td');td.append(element('span',value,'value'));
          if(i===2 && t===newest){
            const badge=element('span','N','new-badge');
            badge.setAttribute('aria-label','새로 확인된 거래');
            badge.title='최근 한 달 내 새로 확인된 거래';
            td.classList.add('has-new');td.append(badge);
          }
          if(i===2&&t.cancelled){td.append(element('span','계약 해제','cancel-label'));if(t.cancellationDate)td.append(element('span',cancelDate(t.cancellationDate),'cancel-label'))}
          r.append(td);
        });tbody.append(r);
      });table.append(tbody);card.append(table);
      if(!active.length)card.append(element('p','이 기간 거래없음 · 위 내역은 모두 계약 해제되었습니다.','empty'));
    }else card.append(element('p',ready?'이 기간 거래없음':'거래 자료를 아직 불러오지 않았습니다.','empty'));
    $('cards').append(card);
  });
  if(data.updatedAt){
    const stamp=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.updatedAt));
    $('updated').textContent=`마지막 정상 갱신 · ${stamp}`;
  }else $('updated').textContent='마지막 정상 갱신 · 아직 없음';
  $('status').hidden = ready;
  $('status').className='notice';
  if(!ready)$('status').textContent='실거래가 자료 연결을 준비하고 있습니다. 아직 조회 전이므로 거래 없음으로 집계하지 않습니다.';
  else if(Date.now()-Date.parse(data.updatedAt)>26*3600000){$('status').hidden=false;$('status').className='notice error';$('status').textContent='자료 갱신이 지연되고 있습니다. 아래 내역은 마지막으로 확인한 자료이며 최신 거래가 누락될 수 있습니다.';}
}
let latest;
async function load(){
  try {
    const response=await fetch(`data/trades.json?t=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error('fetch');
    const data=await response.json();
    if(!['ready','unconfigured'].includes(data.status)||!Array.isArray(data.trades)|| (data.status==='ready'&&!Number.isFinite(Date.parse(data.updatedAt))))throw new Error('schema');
    latest=data;render(data);
  }catch{
    render(latest||{status:'unconfigured',trades:[]});
    $('status').hidden=false;$('status').className='notice error';
    $('status').textContent=latest?'새 자료를 불러오지 못했습니다. 마지막으로 확인한 내역을 표시합니다.':'거래 자료를 불러오지 못했습니다. 잠시 후 다시 접속해 주세요.';
  }
}
load();
setInterval(load,5*60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
