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

class LaunchBadgeTests(unittest.TestCase):
    def test_launch_window_and_no_reseed(self):
        now=datetime(2026,9,14,8,tzinfo=u.KST)
        def trade(day):return dict(date=day,area='84.79',price=74500,group=84,floor='7',cancelled=False)
        rows=[trade(day) for day in ['2026-08-13','2026-08-14','2026-09-05','2026-09-14']]
        history=u.track_first_seen(rows,{},now)
        u.apply_launch_badges(rows,history,{})
        self.assertIsNone(rows[0]['firstSeenAt'])
        self.assertTrue(all(t['firstSeenAt']=='2026-09-14T00:00:00+09:00' for t in rows[1:]))
        previous={'status':'ready','trades':copy.deepcopy(rows),'seenTrades':history,'launchBadgeSeeded':'2026-09-14'}
        later=datetime(2026,9,16,8,tzinfo=u.KST)
        next_rows=copy.deepcopy(rows)+[trade('2026-08-20')]
        history=u.track_first_seen(next_rows,previous,later)
        u.apply_launch_badges(next_rows,history,previous)
        self.assertEqual(next_rows[1]['firstSeenAt'],'2026-09-14T00:00:00+09:00')
        self.assertEqual(next_rows[-1]['firstSeenAt'],later.isoformat(timespec='seconds'))
