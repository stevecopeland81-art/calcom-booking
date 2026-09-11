# Microsoft 365 booking email

Rythms Cal can send template email through one explicitly configured Microsoft 365 mailbox. The mail connection is separate from calendar connections and does not change their scopes or tokens.

## Setup

1. In the existing Office 365 app registration, add a **Web** redirect URI: `https://YOUR_APP_HOST/api/rythms/mail`. Preserve the calendar callback and multitenant configuration.
2. Set runtime variables `EMAIL_FROM` to the exact sender mailbox, `EMAIL_FROM_NAME` to the display name, and `RYTHMS_MICROSOFT_MAIL_OWNER_ID` to the local ADMIN user ID who may connect that sender. The existing `CALENDSO_ENCRYPTION_KEY` must remain stable.
3. Deploy, sign in as that owner, and open **Companies > Calendars & accounts > Booking email**.
4. Choose **Connect Microsoft email** and sign into the configured mailbox. The delegated scopes are `User.Read`, `Mail.Send`, and `offline_access`. Consent is for the signed-in mailbox; tenant-wide application mail permissions are not required. Follow the tenant's approval policy if user consent is restricted.
5. Use **Send a test to my inbox**. A success message means Graph accepted the message, not that delivery has completed. Confirm arrival in the inbox or junk folder before relying on email delivery.

The company email label does not determine the sender. All template email uses the configured sender; template Reply-To values remain intact. Calendar destinations and organizers are configured separately per meeting type. Company membership invitations currently create private links for manual sharing and do not automatically send email.

## Behavior and recovery

- Tokens are stored using authenticated encryption in a separate `rythms_microsoft_mail` credential's `encryptedKey`; plaintext `key` is empty. No schema migration is required.
- Reconnection requires the configured local owner and a current ADMIN role. The callback checks the Microsoft mailbox against `EMAIL_FROM` and validates expiring state and PKCE.
- Message compilation preserves text, HTML, recipients, Reply-To and calendar MIME attachments. It blocks filesystem/URL attachment reads, enforces the From address and caps the encoded request at 4 MiB.
- Refreshes compare the previous ciphertext before updating to avoid overwriting a concurrent reconnection. Sending is not automatically retried because an ambiguous response could follow a successful submission.
- Provider error bodies and tokens are not returned to the browser or printed. A failed test requires checking the app registration, sender and consent and then reconnecting.
- To disable this transport, remove `RYTHMS_MICROSOFT_MAIL_OWNER_ID` and redeploy with a working SMTP configuration. Revoke the app's mail consent in Microsoft if access must also be withdrawn. Do not rotate the shared encryption key as a disconnection mechanism.

Validation: 16 focused unit tests cover mail composition, encrypted tokens, sender restrictions, refresh, authorization, origin checks, PKCE and callback state. A live consent and inbox test must be completed separately.

Reference: [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
