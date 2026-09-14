"""Fetch official monthly snapshots. No third-party Python dependencies."""
import calendar
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from datetime import date, datetime
from decimal import Decimal
from urllib.parse import urlencode, unquote
from urllib.request import urlopen
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'
KST = ZoneInfo('Asia/Seoul')
GROUPS = [59, 84, 113, 129, 148]


def three_months_before(d):
    month = d.year * 12 + d.month - 1 - 3
    year, month = divmod(month, 12)
    month += 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def months_between(start, end):
    d = start.replace(day=1)
    while d <= end:
        yield d.strftime('%Y%m')
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def parse_page(raw):
    root = ET.fromstring(raw)
    for node in root.iter():
        node.tag = node.tag.split('}')[-1]
    code = root.findtext('.//resultCode')
    # The supplied guide documents 000 for success and 03 for no data.
    if code in ('03', '003'):
        return [], 0
    if code not in ('000', '00'):
        raise ValueError('API 응답 오류: ' + (code if code and code.isdigit() else '응답 형식 확인 필요'))
    total = int(root.findtext('.//totalCount', '-1'))
    if total < 0:
        raise ValueError('API 전체 건수 누락')
    return [{n.tag: (n.text or '').strip() for n in item} for item in root.findall('.//item')], total


def fetch_month(key, month, request=None):
    request = request or request_bytes
    rows, page, expected = [], 1, None
    while True:
        params = dict(serviceKey=unquote(key), LAWD_CD='41111', DEAL_YMD=month, pageNo=page, numOfRows=1000)
        items, total = parse_page(request(ENDPOINT + '?' + urlencode(params)))
        if expected is not None and expected != total:
            raise ValueError('조회 중 전체 건수가 변경되었습니다. 다음 실행에서 다시 조회합니다.')
        expected = total
        rows.extend(items)
        if len(rows) == total:
            return rows
        if not items or len(rows) > total or page >= 100:
            raise ValueError('API 페이지 누락 또는 전체 건수 불일치')
        page += 1


def request_bytes(url):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=40) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                # Never log request URLs or exceptions containing serviceKey.
                raise RuntimeError('API 연결 실패: 인증 상태 또는 서비스 상태를 확인하세요.') from None
            time.sleep(2 * (attempt + 1))


def is_target(row):
    if row.get('sggCd') != '41111' or row.get('umdNm') != '천천동':
        return False
    name = re.sub(r'[\s()]', '', row.get('aptNm', ''))
    aliases = {'화서역푸르지오더에듀포레', '천천푸르지오', '천천동푸르지오'}
    jibun = row.get('jibun', '').strip()
    if jibun:
        return jibun == '333' and ('푸르지오' in name)
    return name in aliases


def transform(rows, today):
    start = three_months_before(today)
    result = []
    for row in rows:
        if not is_target(row):
            continue
        d = date(int(row['dealYear']), int(row['dealMonth']), int(row['dealDay']))
        if not start <= d <= today:
            continue
        area = Decimal(row['excluUseAr'])
        group = int(area)
        if group not in GROUPS:
            raise ValueError('대상 단지에 미설정 전용면적이 있습니다. 면적 분류를 확인하세요.')
        price = int(row['dealAmount'].replace(',', ''))
        if price <= 0:
            raise ValueError('거래금액 오류')
        flag = row.get('cdealType', '').strip().upper()
        cancel_day = row.get('cdealDay', '').strip()
        if cancel_day == '-':
            cancel_day = ''
        cancelled = flag not in ('', '-', 'N', '0') or bool(cancel_day)
        result.append(dict(date=d.isoformat(), area=str(area), group=group, price=price,
                           floor=row.get('floor') or None, cancelled=cancelled,
                           cancellationDate=cancel_day or None))
    # Do not deduplicate: identical public fields can be distinct apartment sales.
    return sorted(result, key=lambda x: (x['date'], x['price'], x['area']), reverse=True)


def trade_key(trade):
    # Cancellation is a change to a transaction, not a new transaction.
    fields = [trade['date'], str(Decimal(trade['area']).normalize()),
              trade['price'], str(trade.get('floor')), trade['group']]
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False).encode()).hexdigest()


def track_first_seen(trades, previous, now):
    history = previous.get('seenTrades', {})
    # Existing snapshots establish a baseline; do not guess historical arrival dates.
    if not history:
        for old in previous.get('trades', []):
            key = trade_key(old)
            entry = history.setdefault(key, {'date': old['date'], 'firstSeen': []})
            entry['firstSeen'].append(old.get('firstSeenAt'))
    counts = {}
    initialized = previous.get('status') == 'ready'
    for trade in trades:
        key = trade_key(trade)
        index = counts.get(key, 0)
        counts[key] = index + 1
        entry = history.setdefault(key, {'date': trade['date'], 'firstSeen': []})
        if index >= len(entry['firstSeen']):
            entry['firstSeen'].append(now.isoformat(timespec='seconds') if initialized else None)
        trade['firstSeenAt'] = entry['firstSeen'][index]
    start = three_months_before(now.date()).isoformat()
    return {key: entry for key, entry in history.items() if entry['date'] >= start}


def apply_launch_badges(trades, history, previous):
    """One-time opening promotion; never pretend this is an actual arrival timestamp."""
    if previous.get('launchBadgeSeeded') == '2026-09-14':
        return
    launch = '2026-09-14T00:00:00+09:00'
    for entry in history.values():
        if '2026-08-14' <= entry['date'] <= '2026-09-14':
            entry['firstSeen'] = [stamp if stamp is not None else launch for stamp in entry['firstSeen']]
    counts = {}
    for trade in trades:
        key = trade_key(trade)
        index = counts.get(key, 0)
        counts[key] = index + 1
        trade['firstSeenAt'] = history[key]['firstSeen'][index]


def main():
    key = os.environ.get('MOLIT_API_KEY', '').strip()
    if not key:
        raise RuntimeError('GitHub Secrets에 MOLIT_API_KEY를 등록해 주세요.')
    now = datetime.now(KST)
    today = now.date()
    rows = []
    for month in months_between(three_months_before(today), today):
        rows.extend(fetch_month(key, month))
    trades = transform(rows, today)
    target = ROOT / 'site/data/trades.json'
    previous = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
    history = track_first_seen(trades, previous, now)
    apply_launch_badges(trades, history, previous)
    payload = dict(status='ready', updatedAt=now.isoformat(timespec='seconds'),
                   periodStart=three_months_before(today).isoformat(), periodEnd=today.isoformat(),
                   source='국토교통부 아파트 매매 실거래가 자료', trades=trades, seenTrades=history,
                   launchBadgeSeeded='2026-09-14')
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(target)  # Only replace after every month and page succeeds.
    print(f'정상 갱신: {len(trades)}건 (해제 포함)')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Whitelist our safe messages; unexpected errors may contain credentials.
        message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else '데이터 처리 실패: 기존 공개 자료를 유지합니다.'
        print(message, file=sys.stderr)
        sys.exit(1)
