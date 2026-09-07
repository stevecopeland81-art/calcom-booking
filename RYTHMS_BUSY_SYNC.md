# Microsoft busy-time sync

This feature is opt-in for each Rythms Cal user under **Companies → Calendars → Keep Microsoft calendars busy together**. Connect Microsoft accounts, select 2–20 owned writable calendars, then enable sync. Calendars may belong to different Microsoft 365 companies. Each person authorizes their own accounts; company membership does not grant access to another person's calendar credentials.

The worker checks about every five minutes while the server stays running. The rolling window covers the next 90 days, including ongoing appointments. It mirrors busy, tentative and out-of-office appointments and recurring occurrences. Free events, declined invitations, canceled events, and Rythms-created mirrors are excluded. All-day appointments retain their actual start/end instants, including daylight-saving changes, but the copied block is a timed event.

Only private events titled **Busy** are created, without attendees, notes, locations, reminders or meeting links. Original appointments are never edited. New Rythms bookings are picked up after they appear on the destination Microsoft calendar. Booking conflict checking is configured separately: select all relevant calendars in the existing conflict-checking controls too.

Changing or deleting an original updates or removes its copied blocks after the next successful read. A full successful read of every selected source calendar is required before cancellation cleanup. Pagination and malformed/failed responses stop the run instead of treating unavailable calendars as empty. Markers and persisted mappings prevent mirror loops and recover interrupted creates. Microsoft transaction IDs protect retried creation requests. Database leases serialize workers across replicas. Updates and deletes check the block's ownership marker and use its last-read ETag; a block with attendees or an unexpected organizer is left untouched.

## Runtime and rollout

1. Apply migration `20260908010000_rythms_calendar_sync` using the normal Prisma deployment flow and regenerate Prisma.
2. Deploy the Node.js Next.js application. Next instrumentation starts the worker automatically when `RAILWAY_SERVICE_ID` exists. Other always-on Node hosts must set `RYTHMS_CALENDAR_SYNC_WORKER=1`. Set it to `0` to disable the worker. A serverless/frozen process is not a supported worker host. Disable Railway sleeping for this service.
3. Configure the Microsoft OAuth application and connect each account. Existing delegated `Calendars.ReadWrite` permission is used; this does not add tenant-wide application access.
4. Enable sync only after selecting the intended calendars. The UI shows worker availability, current status, last successful run and failures. **Sync now** queues the run; the worker checks its queue every 30 seconds. Ten due users are processed per queue pass, oldest first. Large sets can take longer and there is no instantaneous-sync guarantee.
5. Validate on isolated Microsoft test calendars before launch: create a busy event in each direction, move it, cancel it, modify a recurring occurrence, test all-day/DST, revoke access, restart the service during a create, and stop/clean up. Check Outlook availability as well as Rythms booking availability.

**Turn off and remove copied blocks** queues cleanup of only recorded, marked Rythms blocks, including blocks on calendars removed from the selection. Keep Microsoft accounts connected until cleanup finishes. Disconnecting an account, deleting a calendar or deleting a Rythms user can leave blocks that need manual removal in Outlook. Reconnecting may create a new credential ID; blocks associated with a deleted connection then require manual cleanup. Existing original appointments remain untouched.

This first version supports owned user calendars, including multiple accounts and companies. Shared/delegated calendars, Microsoft 365 group calendars, Google/Apple mirroring, and events beyond the 90-day window are not supported. Moving or inviting people to a copied block can require manual cleanup; edit the original appointment instead. Microsoft or network outages can delay sync. Incomplete source reads keep existing busy blocks. A failure during writes can leave a partially completed pass; the next run reconciles the remaining work, at least five minutes later and respecting Microsoft Retry-After.

The feature is implemented with the existing dependencies. No real Microsoft account or calendar events were used in automated tests. End-to-end OAuth, create, update, delete, restart recovery, and Outlook visibility must be verified with connected test accounts before production activation.

## References

- [Microsoft calendarView: occurrences, exceptions and pagination](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0)
- [Microsoft event properties and transaction IDs](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)
- [Extended property retrieval and filtering](https://learn.microsoft.com/en-us/graph/api/singlevaluelegacyextendedproperty-get?view=graph-rest-1.0)
