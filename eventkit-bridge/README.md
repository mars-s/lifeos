# LifeOS Calendar gateway

This directory contains a deliberately small EventKit process and a Python adapter.

The Swift process accepts exactly one JSON object on standard input and emits exactly
one JSON object on standard output. It never changes an event unless it first proves
that the event carries the LifeOS work-block marker. It only writes to calendars that
EventKit reports as writable.

Supported operations:

- `authorization_status`
- `request_authorization`
- `list_calendars`
- `list_event_occurrences` (`start`, `end`, optional `calendar_ids`)
- `create_linked_work_block` (`calendar_id`, `link_id`, `things_id`, `title`, `start`, `end`, optional `notes`)
- `create_calendar_event` (`calendar_id`, `link_id`, `title`, `start`, `end`, optional `notes`)
- `update_linked_work_block` (`event_identifier`, optional `title`, `start`, `end`, `notes`)
- `delete_linked_work_block` (`event_identifier`)

Every timestamp is ISO 8601 with an offset. Things-linked LifeOS work blocks carry both
a `lifeos://` URL and a clearly delimited marker in their notes. The
`things:///show?id=...` deep link is included in that managed note block. Standalone
Calendar events carry only the `LIFEOS_EVENT` ownership marker and no app URL.

Build the macOS helper with `swift build`. Run Python tests with
`PYTHONPATH=src python3 -m unittest discover -s tests -v`.
