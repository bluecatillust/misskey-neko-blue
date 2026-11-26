# neko.blue local changes

This public repository contains the corresponding source code for the modified
Misskey version used by `neko.blue`.

## Base version

- Upstream project: <https://github.com/misskey-dev/misskey>
- Misskey version: `2026.11.1-neko.blue` (upstream `2026.11.1`)
- Upstream commit: `f14aeee1bdb6a97e8f5d1ff3ecfb570cc5ad608c`
- License: GNU Affero General Public License v3.0 (`AGPL-3.0-only`)

The earlier 2026.10.1 update imported the source snapshot used for that upgrade
(Git tree `a5195839e165d5129ffc677961533d30c971aa71`). The existing GitHub
reaction-statistics normalization, local-emoji formatting when sharing rankings,
regression tests and this document are retained in addition to that snapshot.
As in earlier public updates, upstream release/deployment workflows and editor
settings are not enabled by this source publication.
The new shared MFM renderer keeps the remote-to-local emoji reaction policy,
renote payloads retain all of the viewer's reactions, and profile cropping
continues to respect upstream's sensitive-file selection restrictions.

The earlier 2026.11.0 update imported the same update patch used for that VPS
upgrade, based on public commit `2f3f37dcaf6e166b74f6d0a53a9ec99308ee8419`.
The patch SHA-256 is
`631aeb86a8bc95b226e253edfc4c2adaa8f8227066917a1dcde01834272f3711`.
It retained all customizations below, including the image-classification
and GIF/WebP original-image changes. Upstream's recursive `withMyPollVotes`
fix and the local multiple-reaction helpers coexist in `NoteEntityService`.

The 2026.11.1 update imports the same update patch used for the VPS upgrade,
based on public commit `a4760f83e6b7e7bb250e72be6060ce5b9fe34dc4`.
The patch SHA-256 is
`4d5cd67a912ab748642c8ac8f8a4542e16ee5f597144aad505746a90a797e24f`.
It retains all customizations below, including hard emoji mute, recent custom
emojis, modal Drive file details, `outgoingAddressFamily` alongside upstream's
`proxyForHpagent` in `HttpRequestService`, and `isCustomEmojiImagePath`
alongside hard emoji mute in `MkCustomEmoji`.
The application reports `2026.11.1-neko.blue`; the suffix identifies this
modified distribution rather than changing the upstream base release.

## Local modifications

### Adapt the emoji picker to wide custom emojis

Files:

- `packages/frontend/src/components/MkEmojiPicker.vue`
- `packages/frontend/src/components/MkEmojiPicker.section.vue`

After a custom emoji image loads, the picker measures its aspect ratio and
uses between one and three grid columns. Wide emoji artwork is therefore shown
at a readable width instead of being reduced to a square cell. Items that do
not fit at the end of a row flow to the next row.

### Reuse a matching local emoji for a remote reaction

File:
`packages/frontend/src/components/MkReactionsViewer.reaction.vue`

When a displayed remote custom-emoji reaction has the same name as an emoji
installed locally, clicking it sends the matching local emoji reaction. A
remote reaction without a same-named local emoji remains unavailable.

### React from matching emojis in remote note text

File:
`packages/frontend/src/components/global/MkMfm.ts`

For a custom emoji displayed in the body of a remote note, the emoji menu
offers the existing reaction action when an emoji with the same name is
installed locally. The reaction uses the local emoji; if no same-named local
emoji exists, the action remains unavailable as before.

### Respect the configured outgoing address family

File:
`packages/backend/src/core/HttpRequestService.ts`

The HTTP and HTTPS agents receive a Node.js `family` value derived from
Misskey's `outgoingAddressFamily` setting. This makes `ipv4`, `ipv6`, and
`dual` select family `4`, `6`, and `0` respectively, and improves remote image
fetching on hosts where the automatically selected address family is not
usable.

### Configure the maximum reaction image width

Files:

- `locales/ja-JP.yml`
- `packages/frontend/src/preferences/def.ts`
- `packages/frontend/src/pages/settings/preferences.vue`
- `packages/frontend/src/components/MkReactionsViewer.reaction.vue`

When reaction-width limiting is enabled, users can choose a maximum image
width of 70, 140, 210, or 280 pixels. The default remains 70 pixels to preserve
the previous behavior. Images smaller than the selected limit are not enlarged.

### Require login to reveal sensitive media

Files:

- `packages/frontend/src/utility/sensitive-file.ts`
- `packages/frontend/src/components/MkMediaImage.vue`

Guests who click media marked as sensitive are shown the sign-in dialog instead
of having the media revealed. Sensitive image links and image source loading are
also disabled while signed out.

### Allow up to five reactions per note

Main files:

- `packages/backend/migration/1790352000000-MultipleNoteReactions.js`
- `packages/backend/src/core/ReactionService.ts`
- `packages/backend/src/core/entities/NoteEntityService.ts`
- `packages/backend/src/models/NoteReaction.ts`
- `packages/backend/src/server/api/endpoints/notes/reactions/`
- `packages/frontend/src/components/MkReactionsViewer.vue`
- `packages/frontend/src/components/MkReactionsViewer.reaction.vue`
- `packages/frontend/src/composables/use-note.ts`
- `packages/frontend/src/composables/use-note-capture.ts`

Local users can attach up to five different reactions to the same note. Each
reaction can be added or removed independently, while duplicate use of the same
emoji by one user on one note remains disallowed. The note API and streaming
payloads expose all reactions selected by the current user, and retain the
single-reaction field for compatibility with older clients.

For Misskey 2026.10.1, the aggregate reaction updates also retain upstream's
parameterized SQL handling for reaction names and user/reaction cache pairs.

### Keep the reaction picker open after selection

File:
`packages/frontend/src/utility/reaction-picker.ts`

The reaction picker remains open after an emoji is selected, allowing users to
add or remove multiple reactions consecutively. It still closes when users
click outside the picker or press Escape.

### Crop profile images selected from Drive

Files:

- `locales/ja-JP.yml`
- `packages/frontend/src/pages/settings/profile.vue`
- `packages/frontend/src/utility/drive.ts`
- `packages/i18n/src/autogen/locale.ts`

Profile avatar and banner images selected from Drive now offer the same crop
confirmation as local uploads. Avatar crops use a 1:1 aspect ratio and banner
crops use 2:1. Cropped images are saved as new Drive files in the original
folder, while choosing not to crop keeps the original file. Non-image files and
image-loading failures are handled with an error message.

### Use original GIF/WebP images when visible and resume sensitive APNG

File:
`packages/frontend/src/components/MkMediaImage.vue`

When a GIF or WebP is visible in the timeline, the frontend uses its original
URL instead of the thumbnail URL, regardless of its sensitive flag. This avoids
losing animation through a still thumbnail. MIME types alone do not distinguish
animated from still files, so still GIF/WebP images also use their originals;
bandwidth and memory use may increase. The display frame size is unchanged.

APNG retains the earlier workaround: a sensitive APNG uses the original after
reveal, while a non-sensitive APNG follows the normal thumbnail path. Hidden
images do not opt into originals through this new branch, and existing sensitive
visibility/login protection and data-saver behavior are unchanged. The normal
`disableShowingAnimatedImages` branch remains before this workaround. Explicit
`raw` or `loadRawImages` still has the pre-existing highest priority, including
over the animation-disable preference; this update does not change that order.

URL selection is covered by 14 regression cases in
`packages/frontend/test/unit/media-image-url.test.ts`. The publication passed
all 215 frontend tests, frontend type checking/build, changed-file lint, SPDX
and locale-safety checks. Actual browser animation playback was not re-tested
against the production server by this publication.

### Show a reaction ranking on the profile reactions tab

Files:

- `packages/backend/src/server/api/endpoints/i/reaction-stats.ts`
- `packages/backend/src/server/api/endpoint-list.ts`
- `packages/frontend/src/pages/user/reactions.vue`
- `packages/misskey-js/src/autogen/`

The signed-in user's profile reaction tab shows the total number of reactions
they currently have attached to notes and a ranking grouped by emoji. The total
includes every active reaction, while the ranking is limited to the top 100
emoji types, ordered by count and then reaction name. The private aggregate API
only returns statistics for the authenticated user. A share button opens the
post composer with the total and the top 10 ranking entries already filled in;
the user can review or edit the text before posting.

### Prefer browser-side H.264 video conversion

Files:

- `packages/frontend/src/utility/compatible-video.ts`
- `packages/frontend/src/utility/video-ffmpeg.ts`
- `packages/frontend/src/composables/use-uploader.ts`
- `packages/frontend/src/components/MkUploaderItems.vue`
- `packages/frontend/src/components/MkPostForm.vue`
- `locales/ja-JP.yml`
- `packages/i18n/src/autogen/locale.ts`
- `packages/frontend/test/unit/compatible-video.test.ts`
- `packages/frontend/test/unit/compatible-video-core.test.ts`
- `packages/frontend/test/unit/use-uploader-video.test.ts`

New local video uploads default to compatibility mode, producing fast-start MP4
with H.264 and AAC-LC in the browser. Low compression caps the long edge at 1920
pixels and the frame rate at 60 fps; medium/high use 1280/854 pixels and 30 fps.
All four compression levels decode and re-encode through browser-side FFmpeg,
including no-compression mode, which basically preserves resolution and frame
rate while using CRF 18. Low/medium/high use CRF 20/23/28. Output is H.264 Main,
8-bit yuv420p, with AAC-LC at 48 kHz and two channels when audio is present.
Rotation and non-square pixels are normalized; silent video stays silent.
Actual output codecs and upload size limits are checked before uploading.
Unsupported inputs, HDR, cancellation and conversion errors block upload until
the user retries or explicitly selects
legacy mode. Switching to legacy resets compression to none; existing legacy
compression remains selectable. Existing Drive files and third-party API clients
are unaffected. No backend API or database changes are required.

The uploader serializes compatibility conversion across uploader instances in
the same tab, displays progress and a keep-open notice, and allows a pending post
to wait for conversion.
Posting locks editing and duplicate submission; an abort action remains available.
Browser unload warnings are best effort and cannot prevent mobile app termination.

The conversion worker, core JavaScript and WASM are served by this Misskey
installation, with no runtime CDN dependency. The engine is downloaded on first
use (about 32 MB), and its worker is terminated after every job. Loading times out
after 120 seconds. The single-threaded core does not require SharedArrayBuffer
or COOP/COEP headers. Conversion uses the user's device, not a server-side encoder.

Dependencies are pinned in `packages/frontend/package.json` and `pnpm-lock.yaml`:
`@ffmpeg/ffmpeg` 0.12.15 (MIT) and `@ffmpeg/core` 0.12.10
(GPL-2.0-or-later, as declared by the npm package). Corresponding source and build
instructions are maintained in the
[ffmpeg.wasm repository](https://github.com/ffmpegwasm/ffmpeg.wasm).

### Manually classify an owned Drive image and share its scores

Files:

- `packages/backend/src/server/api/endpoints/drive/files/detect-image.ts`
- `packages/backend/src/server/api/endpoint-list.ts`
- `packages/frontend/src/utility/get-drive-file-menu.ts`
- `packages/frontend/src/utility/detect-drive-image.ts`
- `packages/misskey-js/src/autogen/`
- `scripts/test-image-detection.mjs`

The Drive file menu offers manual image classification for supported still
images. The authenticated API checks ownership, including for moderators,
before reading the original. It validates both the declared and detected MIME
types, rejects animated/multipage images, and limits input to 20 MiB and
40 million pixels. JPEG, PNG, WebP, AVIF, TIFF, BMP and ICO are offered; videos,
GIF and APNG are not. Animation that cannot be identified from the menu's MIME
type alone is rejected by the server.

Images use the existing automatic detector's preprocessing: 299 x 299 pixels,
orientation correction and gray background for transparency. The existing
configured sensitive-detector service is called server-side; its API key is
never sent to the browser. Missing, invalid or failed predictions produce an
error instead of zero scores. No classification result is saved and none of
`isSensitive`, `maybeSensitive` or `maybePorn` is changed.

The dialog displays Neutral, Drawing, Hentai, Porn and Sexy in that order as
percentages with two decimal places, under the title
`画像判定結果（機械学習による参考値）`. Acknowledge closes the dialog. Share
opens the normal post composer with the displayed text and the analyzed file;
it does not publish automatically or override the normal visibility setting.
The file is refreshed before sharing to preserve its current sensitive flag.

This is the simplified implementation applied in the shared server-update
record: no result cache or custom server-wide concurrency queue is added.
Repeated clicks on the same image in one client are coalesced. The standard
Misskey API rate limit is 3 requests per minute at `rateLimitFactor: 1`; role
coefficients and the existing production-mode limiter still apply. It is not
a fixed limit independent of those settings. The browser waits up to 150
seconds; detector-side requests use the existing server timeout setting.

Run `node scripts/test-image-detection.mjs .` from the repository root for the
29 isolated mock-based regression checks. They cover ownership, input limits,
prediction validation, temporary-file cleanup, close/share behavior and
duplicate clicks, but do not replace live database/HTTP or UI integration tests.
This feature adds no database schema or migration changes. The detector's
installation, API key, runtime configuration and role settings remain private
deployment concerns and are not included in this publication.

Known limit of the deployed implementation: for originals in external storage,
the 20 MiB check is repeated after downloading the original. Transfer itself
uses the existing server-wide `maxFileSize` limit, not a dedicated 20 MiB stream
limit. If the stored size and the actual object differ, more than 20 MiB may be
downloaded before rejection. This publication preserves the deployed source;
per-request transfer limiting would be a separate server change.

Publication validation: PASS for all 29 isolated checks, 201 existing frontend
tests, backend/frontend type checks, API/client regeneration, backend/frontend
builds, changed-file lint, SPDX and locale-safety checks. Live HTTP/DB and
production UI revalidation were SKIPPED here (no local test services and no
production changes); the shared chat records successful server-side testing.

### Completely hide muted emojis (optional hard-mute mode)

Files:

- `locales/ja-JP.yml`
- `packages/frontend/src/components/MkEmojiPicker.section.vue`
- `packages/frontend/src/components/MkEmojiPicker.vue`
- `packages/frontend/src/components/MkNoteDetailed.vue`
- `packages/frontend/src/components/MkNotification.vue`
- `packages/frontend/src/components/MkReactionsViewer.reaction.vue`
- `packages/frontend/src/components/MkReactionsViewer.vue`
- `packages/frontend/src/components/global/MkCustomEmoji.vue`
- `packages/frontend/src/components/global/MkEmoji.vue`
- `packages/frontend/src/pages/chat/XMessage.vue`
- `packages/frontend/src/pages/settings/mute-block.emoji-mute.vue`
- `packages/frontend/src/pages/user/reactions.vue`
- `packages/frontend/src/preferences/def.ts`
- `packages/frontend/src/utility/emoji-mute.ts`
- `packages/frontend/test/setup.unit.ts`
- `packages/frontend/test/unit/hard-emoji-mute.test.ts`
- `packages/i18n/src/autogen/locale.ts`

Settings > Mute and block > Emoji mute adds
`ミュートした絵文字を完全に非表示にする`. It reuses the existing mute list,
defaults to OFF and is not synchronized between devices. OFF retains the usual
replacement-icon behavior; ON removes matching Unicode/custom emoji elements
instead of displaying that icon. The settings list explicitly ignores muting
so its entries remain visible and can be unmuted.

Reaction buttons and counts are filtered before display limits, including the
viewer's own reactions. Reaction animations and detail tabs respect the filter.
The picker filters categories, search results, history and pinned entries, and
prevents selecting hidden entries through keyboard completion. Notifications,
chat reaction displays and the profile ranking display also use the filter;
this does not delete reactions, suppress notification delivery or change API
statistics. Local custom-emoji aliases are normalized while distinct remote
hosts remain distinct, following the existing mute rules.

The follow-up sizing fix is included: visible emoji retain parent class/style
attributes and load listeners through a single conditional root, preserving
thumbnail sizes and the earlier wide-emoji picker behavior. Hard-muted emoji
still render no element.

Supplemental provenance: the files above include the changes from the two
patches applied in the shared VPS chat:

- `hard-emoji-mute-2026.11.0-neko-blue-v2.patch`, SHA-256
  `9b8467393e4ba7edefd2e5865ca1ac5d93605242e868e5d1ae29021fcac4a644`.
- `hard-emoji-mute-sizing-fix.patch`, SHA-256
  `d2e96d43ba15f568f13a786fa9a9e7be4385f56a67090b03cfe5edce5f7202fd`.

The 17 source/test/generated files were checked against the combined patch
tree without further implementation changes. No backend, database schema,
dependency or runtime-configuration changes are required. Per-note reaction
hiding is not part of this feature.

Known behavior retained from the deployed patches: profile ranking totals and
the ranking-share text are still generated from the unfiltered statistics.
Sharing can therefore include emoji names hidden in the ranking display; this
is a visual filter, not removal from shared post content or stored records.
Filtering the shared ranking text would require a separate implementation
change and matching server deployment.

Publication validation: PASS for all 242 frontend tests (including the 27
hard-mute/sizing regressions), frontend type checking, locale regeneration,
complete build, changed-file lint, SPDX and locale-safety checks. Live VPS UI
revalidation is SKIPPED here; this publication does not modify the running
server. The shared chat records successful patch application, builds and
service startup; final post-fix visual confirmation is not recorded there.
Supplemental test-file lint reports two BASELINE errors in the unchanged
`setup.unit.ts` scaffolding (`prefer-const` and `padded-blocks`); neither is on
the added preference definition. The new hard-mute test file itself passes.

### Show recently registered custom emojis

Files:

- `locales/ja-JP.yml`
- `packages/backend/src/server/api/endpoints/emojis.ts`
- `packages/backend/test/unit/server/api/endpoints/emojis.ts`
- `packages/backend/test/e2e/endpoints.ts`
- `packages/frontend/src/pages/about.emojis.vue`
- `packages/i18n/src/autogen/locale.ts`
- `packages/misskey-js/src/autogen/endpoint.ts`
- `packages/misskey-js/src/autogen/entities.ts`
- `packages/misskey-js/src/autogen/types.ts`
- `packages/misskey-js/etc/misskey-js.api.md`

For signed-in users, the custom-emoji tab on the server information page shows
a recent-emoji section above the existing search and category listing. It reuses
the existing emoji cards and their menus. The display-count selector offers 10, 30, 50, 100
and 200 entries, defaults to 30, and is not persisted. The page fetches up to
200 entries once per mount; changing the count slices that list without
another request. Loading, empty, failure and retry states are included.

The public `emojis` API accepts `sort: 'recent'` and `limit` (1–200, default
30). Recent mode returns local emojis by descending registration ID; editing
an existing emoji does not make it newly registered. `limit` applies only to
recent mode. Without a sort parameter, the complete category/name-sorted
listing remains unchanged. No database migration or dependency change is
required.

Supplemental provenance: the implementation matches the deployed
`misskey-2026.11.0-recent-emojis.patch`, SHA-256
`62985276497dc9055b97af37715ce3201659876afe195c8656325403b5d31724`.
Publication also includes API report regeneration and HTTP regression cases;
these do not change deployed application behavior. The shared chat records
successful VPS build/startup and confirmation of the section and default
30-entry selection. The final 200-entry visual check is not recorded there.

Publication validation: PASS for 14 endpoint unit tests, all 242 frontend
tests, frontend/backend type checking, full build, locale/API regeneration,
changed-file lint, SPDX and locale safety. HTTP/DB tests are UNAVAILABLE:
the local test database at `127.0.0.1:54312` could not be reached, so the
additional HTTP regression cases are not counted as passing. Production
revalidation is SKIPPED; this publication does not modify the running VPS.

#### Show recent custom emojis only to signed-in users

File: `packages/frontend/src/pages/about.emojis.vue`

The page shows the recent-emoji section and requests recent entries only when
the viewer is signed in. Guests can still use the regular emoji list and
search. The `emojis` API remains public.

This follow-up applies `misskey-recent-emojis-login-only.patch`, SHA-256
`1288fa8af89c95a69584fbd2ea984e7953a03af5c3668a47a536bf31486fd5ef`.

### Keep drive file details interactive inside modal dialogs

Files:

- `packages/frontend/src/components/MkDrive.file.vue`
- `packages/frontend/src/components/MkPageWindow.vue`
- `packages/frontend/src/os.ts`
- `packages/frontend/src/utility/get-drive-file-menu.ts`

Drive items inherit the existing modal context. When a file context menu is
opened inside a modal, its file-details action opens a modal page window
instead of an ordinary page window. This registers details with the existing
focus-trap management: the selector behind details stays blocked, and closing
an image preview restores interaction to details rather than leaving it inert.
Closing details restores the selector, and closing the selector restores its
parent dialog. This fixes the reported deck-UI watermark editor workflow.

`os.pageWindow` accepts an optional modal flag, defaulting to false.
`MkPageWindow` uses `MkModalWindow` only for modal requests, with close/Escape
handling and popup disposal. Ordinary page windows retain their resize,
navigation, reload and context-menu controls. The normal file-details link
outside modal dialogs is unchanged. No backend, API, locale, dependency or
database changes are required.

Supplemental provenance: these four files match the VPS-applied
`fix-modal-drive-file-details.patch`, SHA-256
`6272cc8642f49f169b11185714c1f76c034c4afd09ba8ddbbe825ad592bf5998`.
The shared chat records successful patch application, changed-file lint,
full build and service startup. Final browser confirmation is not recorded
there; this publication does not modify or restart the running VPS.

Publication validation: PASS for frontend build and type checking, all 242
frontend unit tests, changed-file lint, SPDX and locale safety. An isolated
mounted-component check against this source also passes modal-context/menu
routing, ordinary-window preservation, blocking the underlying selector,
three image-preview close/recovery cycles and detail/selector close recovery.
These DOM checks do not replace a live browser check of native inert behavior;
production browser revalidation is SKIPPED for this source publication.

## Build and configuration

Follow the upstream installation and build instructions for Misskey 2026.11.1.
The repository selects Node.js 26.13.1 and pnpm 12.20.0. Its supported Node.js
release lines are 24 (24.22.3 or newer) and 26 (26.13.1 or newer).
Review upstream's Sentry configuration changes if that integration is enabled.
Install dependencies from the lockfile before building this video-enabled source.
The official `scripts/start.mjs` entry point supports direct startup with
`NODE_ENV=production node ./scripts/start.mjs`, avoiding the package-manager
wrapper. This publication includes that upstream script, not the VPS-specific
systemd drop-in, Node.js installer or runtime paths. The VPS now runs Node.js
26.13.1, pnpm 12.20.0 and this direct startup method.
Runtime configuration and secrets are deliberately not included in this
repository. In particular, `.config/default.yml`, environment files,
credentials, uploaded files, and database contents must remain private.

The complete local code changes can be reviewed by comparing this source tree
with the upstream commit shown above.

### Validation of the 2026.11.1 publication

- PASS: the imported source matches the VPS-applied update patch
  (`4d5cd67a912ab748642c8ac8f8a4542e16ee5f597144aad505746a90a797e24f`).
  `git diff --check` and `scripts/check-spdx.mjs` (2,506 files) pass.
- PASS: the new migration (`1794917481157-following-request-id.js`),
  `CHANGELOG.md` and all 11 updated non-Japanese locale files are verbatim
  upstream 2026.11.1. No non-Japanese translations were edited manually, and
  the existing custom migration (`1790352000000-MultipleNoteReactions.js`) is
  untouched.
- PASS on the VPS with Node.js 26.13.1 and pnpm 12.20.0: patch application,
  `pnpm install --frozen-lockfile`, `pnpm build`, `package.json` and
  `built/meta.json` reporting `2026.11.1-neko.blue`, `pnpm migrate`
  (`FollowingRequestId1794917481157` committed), direct startup via
  `scripts/start.mjs`, worker startup, federation/image registration and
  public `/api/meta` returning `2026.11.1-neko.blue`.
- SKIPPED locally: local `pnpm install`, lint, unit/e2e tests and
  migration-schema checks (no local `pnpm` or test PostgreSQL/Redis services
  were available in the publication environment). Production browser UI
  revalidation is performed separately by the operator.

### Historical validation of the 2026.11.0 publication

- PASS with Node.js 26.13.1 and pnpm 12.17.0: frozen-lockfile installation,
  complete build, API/client regeneration, backend/frontend/shared type checks,
  all 215 frontend tests and the 29 isolated image-classification checks.
- PASS: the merge regression check verifies upstream's recursive poll fix,
  preservation of the existing multiple-reaction helpers, nested payloads and
  reaction hints. Changed-file lint, SPDX and locale safety also pass.
- PASS: the imported source still matches the applied VPS update patch. The
  changed historical migration and the new migration/helper are verbatim
  upstream 2026.11.0, not locally rewritten migration history. No non-Japanese
  locale files were changed by this update.
- UNAVAILABLE/SKIPPED: the local migration-schema check could not connect to
  the test database at `127.0.0.1:54312`; it is not counted as passing. HTTP/DB
  e2e and production UI verification were not re-run here. The shared VPS
  update record reports committed migrations, successful startup and the
  expected version from the production API. This publication does not change
  the running server, its runtime installation or its systemd settings.

### Historical validation of the 2026.10.1 publication

- PASS: complete build, API/client regeneration, backend/frontend/shared type
  checks, 201 frontend tests, changed-file lint and SPDX checks.
- BASELINE: the locale-safety check flags 27 non-Japanese files imported from
  upstream; every one was verified identical to the official 2026.10.1 tag.
  No non-Japanese translations were edited manually.
- SKIPPED: local database migration/e2e validation; no local PostgreSQL/Redis
  test services are available. The ReactionService suite could not start for
  that reason (25 tests skipped), so it is not counted as passing. The shared
  server-upgrade record reports successful migrations and a clean schema for
  the imported source snapshot; this is not a new production-server test.
