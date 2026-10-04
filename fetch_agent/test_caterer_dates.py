import unittest
from datetime import date
from unittest.mock import patch
from .caterer_dates import period, single_day, report_request, local_today


class CatererDateTests(unittest.TestCase):
    today = date(2026, 10, 4)

    def test_single_days_and_explicit_years(self):
        for text, expected in [
            ('June 10th', '2026-06-10'), ('orders for Jun 10', '2026-06-10'),
            ('June 10, 2030', '2030-06-10'), ('10th June 2030', '2030-06-10'),
            ('2030-06-10', '2030-06-10'), ('today', '2026-10-04'),
            ('tomorrow', '2026-10-05'), ('yesterday', '2026-10-03'),
            ('next friday', '2026-10-09'), ('this friday', '2026-10-02')]:
            with self.subTest(text=text):
                self.assertEqual(period(text, today=self.today), {'start': expected, 'end': expected})

    def test_named_ranges_and_existing_iso_ranges(self):
        for text in ('June 10th–16th, 2030', 'June 10-16 2030', 'June 10 to June 16, 2030',
                     'June 10, 2030 through 16', '2030-06-10 2030-06-16'):
            with self.subTest(text=text):
                self.assertEqual(period(text, today=self.today), {'start': '2030-06-10', 'end': '2030-06-16'})

    def test_context_year_relative_days_and_fallback(self):
        self.assertEqual(period('June 10th', today=self.today, year=2030)['start'], '2030-06-10')
        self.assertEqual(period('today', today=self.today, year=2030)['start'], '2026-10-04')
        fallback = {'start': '2030-06-10', 'end': '2030-06-10'}
        self.assertEqual(period('', today=self.today, fallback=fallback), fallback)
        self.assertEqual(period('this week', today=self.today, fallback=fallback), {'start': '2026-09-28', 'end': '2026-10-04'})
        self.assertEqual(period('next week', today=self.today)['start'], '2026-10-05')
        self.assertEqual(period('last week', today=self.today)['start'], '2026-09-21')

    def test_invalid_dates_and_ambiguous_text_never_fall_back_to_week(self):
        for text in ('February 30th', 'February 29, 2027', '2030-02-30', 'June 0th', 'June 32nd',
                     'June 16 to June 10', 'June 1 to July 10', 'June 10 and June 16', '2030-06-10 extra',
                     'June 10 to June 11 to June 12', 'garbage'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                period(text, today=self.today)
        self.assertEqual(single_day('February 29, 2028').isoformat(), '2028-02-29')
        self.assertEqual(period('December 31, 2030 to January 1, 2031')['end'], '2031-01-01')

    def test_message_routing_preserves_order_actions(self):
        self.assertEqual(report_request('June 10th'), ('orders', 'june 10'))
        self.assertEqual(report_request('show me orders for June 10th'), ('orders', 'for june 10'))
        self.assertEqual(report_request('order all ingredients from Instacart'), ('groceries', ''))
        self.assertEqual(report_request('instacart for tomorrow'), ('groceries', 'for tomorrow'))
        self.assertIsNone(report_request('accept 1'))
        self.assertIsNone(report_request('new form'))

    def test_configured_timezone_is_used(self):
        with patch.dict('os.environ', {'CATERER_TIMEZONE': 'America/Detroit'}), patch('fetch_agent.caterer_dates.datetime') as clock:
            clock.now.return_value.date.return_value = self.today
            self.assertEqual(local_today(), self.today)
            self.assertEqual(str(clock.now.call_args.args[0]), 'America/Detroit')
