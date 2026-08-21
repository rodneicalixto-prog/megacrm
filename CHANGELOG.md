# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Ordered round-robin assignment queues per department for supervisors and
  operators.
- Direct routing for personal WhatsApp lines linked to an occupied department
  position, bypassing department queues.
- Inbox controls for quoted replies, reactions, forwarding, typing presence,
  screenshots, emoji selection, and Evolution voice notes.
- Light/dark theme selection, navigable dashboard cards, and on-demand contact
  details in the Inbox.
- Notification grouping by contact and pending-action type.

### Fixed

- Allow `super_admin`, `admin`, `supervisor`, and `operator` to reply from the
  Inbox.
- Surface Evolution API delivery errors in the Inbox instead of silently
  treating them as successful sends.
- Repair residual multi-tenant inbound and handoff triggers that rejected new
  messages after the `tenant_id` column was removed.
- Release webhook deduplication reservations on persistence failures so
  Evolution can retry instead of silently losing messages.
- Keep the configured global Evolution instance routed to the default
  department during migration while rejecting unknown instance names.
- Prevent personal lines from being linked to positions without an assigned
  user and keep administrators out of automatic assignment queues.
- Recover inbound Evolution audio when the webhook does not include a directly
  playable URL.
- Clear unread state and pending notifications when a conversation is closed;
  closed conversations can no longer appear in the unread queue.
- Remove viewed notifications immediately instead of retaining and stacking
  historical message rows in the notification tray.
- Keep the active Inbox panel synchronized when conversations are closed or
  reopened.

### Security

- Keep Evolution group payloads (`@g.us`) disabled until the data model stores
  the group remote JID and outbound replies can be guaranteed to target the
  group instead of a participant's private number.

## [1.0.0] — 2026-04-30

First open-source self-hosted release. Migration from the SaaS multi-tenant
codebase to a single-organization deployable image.

### Changed

- Migrated SaaS multi-tenant build to Open Source Self-Hosted (single
  organization per instance).
- BYOK removed — Meta and LLM credentials now come from Edge Function
  environment variables (`META_*`, `OPENAI_API_KEY`, `LLM_PROVIDER`,
  `LLM_API_KEY`) instead of the encrypted `tenant_credentials` table.
- White-label (dynamic logo / favicon / brand colors) removed. The fixed
  Agentise dark glassmorphism theme is the only theme.
- Onboarding wizard collapsed into `SettingsPage` sections (AI agent, business
  hours, team, account, Supabase).
- Roles consolidated to `admin` / `operator`. The first signed-up user is
  promoted to `admin`; subsequent users land as `operator`.

### Removed

- `tenants`, `tenant_settings`, `tenant_credentials` tables.
- `tenant_id` from every domain table and from every frontend query / type.
- `super_admin` role and the `/admin` super-admin panel.
- `OnboardingPage` and the six onboarding steps.
- `save-tenant-credentials` Edge Function.
- `whatsapp-hub-logos` storage bucket and its multi-tenant policies.
- `app.whatsapp_hub_encryption_key` Vault entry (and `pgcrypto` symmetric
  helpers used only by `tenant_credentials`).

### Renamed

- `tenant_members` → `app_users`.

### Kept intentionally

- `/setup` route — the operator pastes Supabase URL + anon key into the
  browser on first visit; nothing about the build needs to change per
  deployment.
- Supabase schema namespace `whatsapp_hub` — the Supabase project may be
  shared with other Agentise apps.
- Meta tier caps (`tier_250` / `tier_1k` / `tier_10k` / `tier_100k`) — these
  are official Meta limits, not commercial plans, and gate the dispatcher
  batch size.
- `push-migrations.mjs` and `deploy-functions.mjs` scripts. They use the
  Supabase Management API (no DB password required) and remain the
  recommended ops path.
