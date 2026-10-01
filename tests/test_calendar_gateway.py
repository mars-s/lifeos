import json
import unittest

from lifeos.calendar_gateway import CalendarGateway, CalendarGatewayError

CALENDAR = {
    "id": "planner-calendar",
    "title": "Planned Tasks",
    "source_id": "icloud-source",
    "source_title": "iCloud",
    "allows_modifications": True,
    "read_only": False,
    "type": 0,
}
EVENT = {
    "event_identifier": "occurrence-1",
    "calendar_item_identifier": "series-1",
    "calendar_id": "planner-calendar",
    "calendar_source_id": "icloud-source",
    "title": "Write report",
    "start": "2026-09-22T09:00:00+10:00",
    "end": "2026-09-22T10:00:00+10:00",
    "all_day": False,
    "notes": "[[LIFEOS_WORK_BLOCK]]",
    "location": "",
    "url": "lifeos://planned-work-block/link-1",
    "planner_owned": True,
}


class FakeRunner:
    def __init__(self, response):
        self.response = response
        self.args = None
        self.request = None

    def __call__(self, args, input_data):
        self.args = list(args)
        self.request = json.loads(input_data)
        return json.dumps(self.response).encode()


class CalendarGatewayTests(unittest.TestCase):
    def test_creates_planner_calendar_on_requested_source(self):
        runner = FakeRunner({"ok": True, "result": {"calendar": CALENDAR}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        calendar = gateway.create_planner_calendar("Planned Tasks", "icloud-source")

        self.assertEqual(
            runner.request,
            {
                "operation": "create_planner_calendar",
                "title": "Planned Tasks",
                "source_id": "icloud-source",
            },
        )
        self.assertEqual(calendar["id"], "planner-calendar")

    def test_accepts_empty_optional_event_text(self):
        event = dict(EVENT, event_identifier="", title="", notes="", url="")
        runner = FakeRunner({"ok": True, "result": {"events": [event]}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        snapshot = gateway.list_event_occurrences(EVENT["start"], EVENT["end"])

        self.assertEqual(snapshot.events[0]["url"], "")

    def test_lists_calendars_with_stable_hash_and_argument_array(self):
        runner = FakeRunner({"ok": True, "result": {"calendars": [CALENDAR]}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        snapshot = gateway.list_calendars()

        self.assertEqual(runner.args, ["/tmp/lifeos-calendar-helper"])
        self.assertEqual(runner.request, {"operation": "list_calendars"})
        self.assertEqual(snapshot.calendars[0]["source_id"], "icloud-source")
        self.assertEqual(len(snapshot.source_hash), 64)
        self.assertEqual(snapshot.source_hash, gateway.list_calendars().source_hash)

    def test_lists_occurrences_and_passes_selected_calendar_ids(self):
        runner = FakeRunner({"ok": True, "result": {"events": [EVENT]}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        snapshot = gateway.list_event_occurrences(
            "2026-09-22T00:00:00+10:00", "2026-09-23T00:00:00+10:00", ["planner-calendar"]
        )

        self.assertEqual(runner.request["calendar_ids"], ["planner-calendar"])
        self.assertTrue(snapshot.events[0]["planner_owned"])
        self.assertEqual(len(snapshot.source_hash), 64)

    def test_create_sends_things_link_inputs_without_using_a_shell(self):
        runner = FakeRunner({"ok": True, "result": {"event": EVENT}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        event = gateway.create_linked_work_block(
            calendar_id="planner-calendar",
            link_id="link-1",
            things_id="things-123",
            title="Write report",
            start=EVENT["start"],
            end=EVENT["end"],
            notes="Deep work",
        )

        self.assertEqual(runner.args, ["/tmp/lifeos-calendar-helper"])
        self.assertEqual(runner.request["operation"], "create_linked_work_block")
        self.assertEqual(runner.request["things_id"], "things-123")
        self.assertEqual(event["event_identifier"], "occurrence-1")

    def test_create_calendar_event_does_not_invent_a_things_link(self):
        standalone_event = dict(EVENT, notes="[[LIFEOS_EVENT]]", url="")
        runner = FakeRunner({"ok": True, "result": {"event": standalone_event}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        event = gateway.create_calendar_event(
            calendar_id="home-calendar",
            link_id="amazon-delivery",
            title="Amazon delivery — HOTO screwdriver",
            start="2026-09-23T17:00:00+10:00",
            end="2026-09-23T22:00:00+10:00",
            notes="Delivery window",
        )

        self.assertEqual(runner.request["operation"], "create_calendar_event")
        self.assertNotIn("things_id", runner.request)
        self.assertEqual(event["url"], "")
        self.assertEqual(event["event_identifier"], "occurrence-1")

    def test_create_calendar_event_passes_location_for_eventkit_and_readback(self):
        standalone_event = dict(
            EVENT,
            notes="[[LIFEOS_EVENT]]",
            url="",
            location="Carlson Reserve free public tennis court",
        )
        runner = FakeRunner({"ok": True, "result": {"event": standalone_event}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        event = gateway.create_calendar_event(
            calendar_id="home-calendar",
            link_id="tennis-2026-09-24",
            title="Play tennis",
            start="2026-09-24T10:00:00+10:00",
            end="2026-09-24T11:00:00+10:00",
            location="Carlson Reserve free public tennis court",
        )

        self.assertEqual(runner.request["location"], "Carlson Reserve free public tennis court")
        self.assertEqual(event["location"], "Carlson Reserve free public tennis court")

    def test_rejects_malformed_success_response(self):
        runner = FakeRunner({"ok": True, "result": {"events": [{"title": "missing fields"}]}})
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        with self.assertRaisesRegex(CalendarGatewayError, "calendar_item_identifier"):
            gateway.list_event_occurrences("2026-09-22T00:00:00+10:00", "2026-09-23T00:00:00+10:00")

    def test_surfaces_native_error_without_accepting_it_as_data(self):
        runner = FakeRunner(
            {"ok": False, "error": {"code": "calendar_read_only", "message": "No writes"}}
        )
        gateway = CalendarGateway("/tmp/lifeos-calendar-helper", runner=runner)

        with self.assertRaisesRegex(CalendarGatewayError, "calendar_read_only: No writes"):
            gateway.create_linked_work_block(
                calendar_id="planner-calendar",
                link_id="link-1",
                things_id="things-123",
                title="Write report",
                start=EVENT["start"],
                end=EVENT["end"],
            )

    def test_rejects_relative_helper_paths(self):
        with self.assertRaisesRegex(ValueError, "absolute"):
            CalendarGateway("./lifeos-calendar-helper", runner=FakeRunner({}))


if __name__ == "__main__":
    unittest.main()
