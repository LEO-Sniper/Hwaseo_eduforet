import importlib.util
from pathlib import Path
import unittest
from datetime import date
from urllib.parse import urlparse, parse_qs

spec = importlib.util.spec_from_file_location('update', Path(__file__).resolve().parents[1]/'scripts/update_data.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)

def row(**changes):
    item=dict(sggCd='41111', umdNm='천천동', jibun='333', aptNm='화서역 푸르지오 더에듀포레',
              dealYear='2026',dealMonth='9',dealDay='13',excluUseAr='84.79',dealAmount='74,500',floor='7',cdealType='',cdealDay='')
    item.update(changes)
    return item

def xml(items,total):
    return ('<response><header><resultCode>000</resultCode></header><body><items>'+''.join('<item><sggCd>41111</sggCd></item>' for _ in range(items))+f'</items><totalCount>{total}</totalCount></body></response>').encode()

class DataTests(unittest.TestCase):
    def test_calendar_boundary(self):
        self.assertEqual(u.three_months_before(date(2026,5,31)),date(2026,2,28))
        self.assertEqual(u.three_months_before(date(2024,5,31)),date(2024,2,29))
        self.assertEqual(list(u.months_between(date(2025,10,13),date(2026,1,13))),['202510','202511','202512','202601'])

    def test_contract_date_window_and_cancel(self):
        data=[row(dealMonth='6',dealDay='12',cdealType='O',cdealDay='20260913'), row(dealMonth='6',dealDay='13'),row(cdealType='O',cdealDay='26.09.14'),row(dealDay='14')]
        result=u.transform(data,date(2026,9,13))
        self.assertEqual(len(result),2)
        self.assertTrue(result[0]['cancelled'])
        self.assertEqual(result[1]['date'],'2026-06-13')

    def test_identity_and_variants(self):
        for area in ['84.92','84.8','84.79','84.89']:
            self.assertEqual(u.transform([row(excluUseAr=area)],date(2026,9,13))[0]['group'],84)
        self.assertFalse(u.is_target(row(jibun='334')))
        self.assertFalse(u.is_target(row(umdNm='정자동')))
        self.assertTrue(u.is_target(row(aptNm='천천푸르지오',jibun='')))
        self.assertFalse(u.is_target(row(aptNm='화서역파크푸르지오',jibun='')))

    def test_identical_rows_preserved(self):
        self.assertEqual(len(u.transform([row(),row()],date(2026,9,13))),2)

    def test_no_data_vs_error(self):
        self.assertEqual(u.parse_page(xml(0,0)),([],0))
        with self.assertRaises(ValueError):u.parse_page(b'<response><resultCode>30</resultCode></response>')
        with self.assertRaises(ValueError):u.parse_page(b'<response><resultCode>000</resultCode></response>')

    def test_pagination_and_encoding(self):
        calls=[]
        def request(url):
            q=parse_qs(urlparse(url).query);calls.append(q)
            return xml(1,2)
        self.assertEqual(len(u.fetch_month('a%2Bb%2Fc%3D','202609',request)),2)
        self.assertEqual(calls[0]['serviceKey'],['a+b/c='])
        self.assertEqual(calls[1]['pageNo'],['2'])

    def test_truncated_page_fails(self):
        calls=iter([xml(1,2),xml(0,2)])
        with self.assertRaises(ValueError):u.fetch_month('test','202609',lambda _:next(calls))

    def test_all_area_groups_and_cancellation(self):
        for area,group in [('59.98',59),('113.04',113),('129.82',129),('148.75',148)]:
            t=u.transform([row(excluUseAr=area,cdealType='N')],date(2026,9,13))[0]
            self.assertEqual(t['group'],group)
            self.assertFalse(t['cancelled'])
        self.assertTrue(u.transform([row(cdealDay='20260913')],date(2026,9,13))[0]['cancelled'])

if __name__=='__main__':unittest.main()
