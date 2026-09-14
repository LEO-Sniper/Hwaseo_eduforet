from test_update import u
from datetime import datetime
import unittest
import copy

class NewTradeTests(unittest.TestCase):
    def test_arrival_repeat_cancel_and_reappearance(self):
        old=dict(date='2026-08-01',area='84.79',price=74500,group=84,floor='7',cancelled=False)
        new=dict(old,date='2026-08-05',price=78000)
        now=datetime(2026,9,14,8,tzinfo=u.KST)
        rows=copy.deepcopy([old,new]);history=u.track_first_seen(rows,{'status':'ready','trades':[old]},now)
        self.assertIsNone(rows[0]['firstSeenAt'])
        self.assertEqual(rows[1]['firstSeenAt'],now.isoformat(timespec='seconds'))
        previous={'status':'ready','trades':rows,'seenTrades':history}
        repeated=copy.deepcopy([old,new]);repeated[1]['cancelled']=True
        u.track_first_seen(repeated,previous,datetime(2026,9,15,8,tzinfo=u.KST))
        self.assertEqual(repeated[1]['firstSeenAt'],rows[1]['firstSeenAt'])
        previous['trades']=[rows[0]]
        restored=copy.deepcopy([new]);u.track_first_seen(restored,previous,datetime(2026,9,20,8,tzinfo=u.KST))
        self.assertEqual(restored[0]['firstSeenAt'],rows[1]['firstSeenAt'])

    def test_initial_baseline_and_duplicate_count(self):
        t=dict(date='2026-08-01',area='84.79',price=74500,group=84,floor='7',cancelled=False)
        now=datetime(2026,9,14,8,tzinfo=u.KST)
        rows=[copy.deepcopy(t)];h=u.track_first_seen(rows,{},now)
        self.assertIsNone(rows[0]['firstSeenAt'])
        duplicates=[copy.deepcopy(t),copy.deepcopy(t)];u.track_first_seen(duplicates,{'status':'ready','trades':rows,'seenTrades':h},now)
        self.assertIsNone(duplicates[0]['firstSeenAt'])
        self.assertIsNotNone(duplicates[1]['firstSeenAt'])
