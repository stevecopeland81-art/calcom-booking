# Rythms Cal

Rythms Cal adds company workspaces, people, and short booking links to the MIT-licensed Cal.diy community codebase. The `open-source-booking` branch starts at upstream commit `e91bb0c38251b0ee6f87eec70ce4940822fb0cf3`. The upstream license and attribution remain in `LICENSE`.

## What this branch adds

- **Companies:** create multiple company profiles with separate names, descriptions, colors, and booking pages. New companies start unpublished.
- **People:** company owners create private invitation links tied to a verified email address. A person can belong to multiple companies and choose which of their own meeting types to publish in each. Owners can revoke invitations and remove members. Removing a member removes their company meeting assignments without deleting their account, meeting types, or bookings.
- **Calendars:** the workspace brings the existing calendar connection, conflict checking, and destination calendar controls together. Each person connects their own accounts. Choosing shared conflict checking makes the selected meeting types use that person's selected calendars across companies.
- **Short links:** create multiple unique aliases such as `/b/steve`, `/b/rythmz`, or `/b/intro`. An alias can open a portfolio of published companies, one company, or a particular meeting. Examples are not automatically reserved. The public page shows each meeting's host and routes to that host's booking page.
- **Branding:** Rythms Cal app name and original logo assets.

Company contact email is a private administrative label. It does not authenticate another mailbox or change the calendar destination or email sender. Members cannot access another person's calendar credentials. Invitation links expire after seven days; only their hashes are stored. This version creates copyable invitation links and does not send them automatically.

Calendar consolidation combines selected calendars for availability and writes new bookings to the selected destination. Optional [Microsoft busy-time sync](RYTHMS_BUSY_SYNC.md) also copies private Busy blocks between each person's selected Microsoft calendars, including changes and cancellations, within a rolling 90-day window. This workspace does not add round-robin allocation, collective meetings, company billing, or custom permission roles.

## Microsoft 365 and additional accounts

The upstream Office 365 calendar app uses Microsoft OAuth. Configure `MS_GRAPH_CLIENT_ID` and `MS_GRAPH_CLIENT_SECRET` in the deployment, using an Entra app registration appropriate for the organizations/accounts that will connect. Configure its web redirect URI as `https://YOUR_APP_HOST/api/integrations/office365calendar/callback`. Follow the Office 365 setup section in the upstream README for delegated permissions and consent.

Keep client secrets and calendar credentials out of source control. After starting the app, connect each account through **Companies → Calendars & accounts → Connect account**, then select the calendars to check and the destination calendar. Each member signs in separately and authorizes their own accounts. Cross-tenant consent and shared/delegated mailbox access depend on Microsoft policy and must be tested with the actual accounts.

Configure a working email provider using the upstream email environment variables, including `EMAIL_FROM`, before inviting new users. Invitation acceptance requires a verified account email. Use a verified sender/domain for confirmations and password recovery.

## Railway deployment

`railway.json` uses the repository Dockerfile and `/api/logo` health check. Set `NEXT_PUBLIC_APP_NAME=Rythms Cal`, `NEXT_PUBLIC_WEBAPP_URL`, `NEXTAUTH_URL`, database URLs, `NEXTAUTH_SECRET`, and `CALENDSO_ENCRYPTION_KEY` for the target deployment. The public URL must be correct at build time as well as runtime; use Railway build variables where required by the Dockerfile. Configure email and OAuth before accepting real bookings.

Validate this branch on a separate staging service and database first. When upgrading an older installation, review and rehearse all intervening upstream migrations against a backup before production cutover.

The Rythms-specific migration `20260907190000_rythms_workspace` adds five tables and foreign keys; it does not delete or rewrite existing booking data. Generate Prisma, apply migrations, seed the configured apps using the upstream startup workflow, and verify signup, email verification, two Microsoft accounts, secondary calendar conflicts, destination writes, cancellation, rescheduling, member removal, and public aliases before production cutover.

Use a short domain or a subdomain you own for a shorter hostname. The `/b/...` aliases work on the deployment hostname already. Domain registration, DNS, certificates, and Microsoft redirect URI changes are separate configuration steps; no domain has been purchased or connected by this branch.

## Validation commands

```sh
node .yarn/releases/yarn-4.12.0.cjs install --immutable
node .yarn/releases/yarn-4.12.0.cjs workspace @calcom/prisma prisma generate
node .yarn/releases/yarn-4.12.0.cjs vitest run apps/web/modules/rythms
node node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json
```

The workspace service tests cover ownership, public data filtering, published/hidden states, aliases, invitation expiry and email binding, cross-company membership, and removal without deleting meeting types. Live OAuth and booking tests require configured services and actual authorized accounts.
