# CALENDY: Microsoft 365 and multiple calendars

## Current status

The `m365-multicalendar` branch starts at Cal.com v6.2.0, commit
`1c193cca8682b33b9866c792186033f7ef886682`.
This matches the version of the original Docker deployment:
`calcom/cal.com@sha256:ace3bb1219fb7306585ab9f4d94d41af7ee064c343db0498173436bbe857bd49`.

The repository was forked from `calcom/cal.diy`, the new name of the upstream
repository. Its `main` branch is a different product version with team features
removed. Use `m365-multicalendar` for this work; do not sync it automatically to
upstream `main`.

The source and Railway build configuration are prepared. Microsoft OAuth,
calendar connections, booking links, email delivery, and a source-built Railway
deployment have not yet been configured or verified end to end.

## Intended booking experience

- Connect multiple Microsoft 365 accounts to one scheduling profile.
- Select primary and secondary calendars that should block availability.
- Choose a writable calendar for new bookings; each event type can have its own
  destination where supported.
- Publish individual event-type links and a profile page listing bookable types.
- Support additional hosts with their own accounts, calendars, and booking pages.
- Configure durations, availability schedules, buffers, notice periods, timezone
  handling, cancellation/rescheduling, and confirmation email delivery.

Availability aggregation is separate from copying existing events between
calendars. Event mirroring needs its own rules for privacy, direction, duplicate
prevention, updates, and deletion; it is not implemented by this setup.

## Microsoft setup

1. Sign into Microsoft Azure / Entra using the directory that will own the OAuth
   app registration. Inspect an existing registration before creating another.
2. Register a web application. For accounts in multiple Microsoft 365 tenants,
   select support for accounts in any organizational directory.
3. Add an HTTPS redirect URI using the actual deployment origin:
   `<deployment-origin>/api/integrations/office365calendar/callback`.
   Register staging and production origins explicitly; do not use wildcards.
4. The v6.2.0 calendar flow requests delegated `User.Read`, `Calendars.Read`,
   `Calendars.ReadWrite`, and `offline_access`. Review consent with the account
   owner or tenant administrator. These are not tenant-wide application grants.
5. Store the app's client ID and secret in Railway as `MS_GRAPH_CLIENT_ID` and
   `MS_GRAPH_CLIENT_SECRET`. Never commit credentials, tokens, or `.env` files.
6. The existing `scripts/start.sh` runs `scripts/seed-app-store.ts`; that script
   seeds/enables the Office 365 app when both Microsoft variables are supplied.
7. Sign into Cal.com, connect each Microsoft account separately, and choose every
   calendar that should block bookings. The OAuth callback initially selects only
   the default calendar, so secondary calendars must be selected afterward.

Shared/delegated calendars require a separate test with the actual mailbox
permissions. The current OAuth flow does not request `.Shared` scopes; do not
claim universal shared-mailbox support. Microsoft 365 group and resource
calendars may need additional implementation. Only grant access required for
the selected calendars and the user's authorized workflow.

## Railway deployment

`railway.json` builds the branch's source with the existing root `Dockerfile` and
uses the original `/api/logo` healthcheck and restart policy. It does not deploy
an unchanged upstream image, so later source changes can be included in builds.

Prepare a staging environment with its own database and domain first. Supply
its database settings, `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`,
`NEXT_PUBLIC_WEBAPP_URL`, `NEXTAUTH_URL`, `DATABASE_HOST`, and `PORT` as required
by the stock Dockerfile/start script. Review the upstream build arguments in
`Dockerfile`. Do not use the production database during staging tests.

Keep the existing production database and encryption keys when cutting over;
replacing the encryption key would make existing stored credentials unusable.
Verify a database backup before changing deployment sources. The start script
applies database migrations. Connect the GitHub repository and explicitly select
`m365-multicalendar`; creating the GitHub branch alone does not change Railway.

Configure `EMAIL_FROM` and an email provider before relying on confirmation,
cancellation, password-reset, or invitation emails. Railway billing must also be
current for dependable hosting.

## Additional users and team scheduling

Cal.com v6.2.0's README identifies users, teams, organizations, managed event
types, and workflows as Enterprise Edition features. Resolve the applicable
Cal.com license for the intended multi-user deployment before enabling those
features in production. No license checks have been removed or bypassed.

## Acceptance checks before production cutover

- Connect two Microsoft accounts and select calendars in both.
- Verify a busy event in either account removes the corresponding booking slot.
- Check secondary calendars, recurring events, all-day events, and daylight saving.
- Check calendar permission failures are surfaced rather than treated as free time.
- Test token refresh/reconnection and writable versus read-only destinations.
- Test every event-type link and the unified profile page.
- Create, reschedule, and cancel a test booking; verify the intended destination
  calendar and email notifications each time.
- Test any required shared calendars independently.
- Verify the permitted additional-host onboarding and booking flow.
- Run the repository's relevant tests/type checks and a staging Docker build.

## References

- [Cal.com v6.2.0 source and licensing matrix](https://github.com/calcom/cal.diy/tree/v6.2.0)
- [Microsoft shared and delegated calendar behavior](https://learn.microsoft.com/en-us/graph/outlook-get-shared-events-calendars)
- [Railway configuration reference](https://docs.railway.com/config-as-code/reference)
