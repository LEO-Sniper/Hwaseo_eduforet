from test_update import u
from datetime import datetime
import unittest

class RegistrationTests(unittest.TestCase):
    def test_backfill_is_distinct_from_launch_badge(self):
        trade=dict(date='2026-09-05',area='84.89',price=91000,floor='22',group=84)
        key=u.trade_key(trade)
        history={key:{'date':trade['date'],'firstSeen':['2026-09-14T00:00:00+09:00']}}
        u.track_registration([trade],history,{key:['2026-09-13T23:46:00+09:00']})
        self.assertEqual(trade['registeredAt'],'2026-09-13T23:46:00+09:00')
        u.track_registration([trade],history,{})
        self.assertEqual(trade['registeredAt'],'2026-09-13T23:46:00+09:00')

    def test_new_record_and_unknown_baseline(self):
        trade=dict(date='2026-09-05',area='84.89',price=91000,floor='22',group=84)
        key=u.trade_key(trade)
        history={key:{'date':trade['date'],'firstSeen':['2026-09-14T00:00:00+09:00','2026-09-20T08:00:00+09:00']}}
        other=dict(trade,cancelled=True)
        u.track_registration([trade,other],history,{})
        self.assertIsNone(trade['registeredAt'])
        self.assertEqual(other['registeredAt'],'2026-09-20T08:00:00+09:00')
