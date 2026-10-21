# neko.blue local changes

This public repository contains the corresponding source code for the modified
Misskey version used by `neko.blue`.

## Base version

- Upstream project: <https://github.com/misskey-dev/misskey>
- Misskey version: `2026.10.0`
- Upstream commit: `de89118a225fbe0833e42ab94e8d5af1e5211208`
- License: GNU Affero General Public License v3.0 (`AGPL-3.0-only`)

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

For Misskey 2026.10.0, the aggregate reaction updates also retain upstream's
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

### Resume sensitive animated images after reveal

File:
`packages/frontend/src/components/MkMediaImage.vue`

After a sensitive GIF or APNG is revealed in the timeline, the frontend uses
the original animated image URL instead of the thumbnail URL. This works around
animation playback remaining stuck on the first frame in iOS Safari. The
preference to disable animated-image playback still takes priority, and the
original file is loaded only after the user reveals sensitive animated media.

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

## Build and configuration

Follow the upstream installation and build instructions for Misskey 2026.10.0.
Install dependencies from the lockfile before building this video-enabled source.
Runtime configuration and secrets are deliberately not included in this
repository. In particular, `.config/default.yml`, environment files,
credentials, uploaded files, and database contents must remain private.

The complete local code changes can be reviewed by comparing this source tree
with the upstream commit shown above.
