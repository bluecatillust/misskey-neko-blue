# neko.blue local changes

This public repository contains the corresponding source code for the modified
Misskey version used by `neko.blue`.

## Base version

- Upstream project: <https://github.com/misskey-dev/misskey>
- Misskey version: `2026.9.0`
- Upstream commit: `bd9eb7c77942ef11749a04e7a5f24bee935d764b`
- License: GNU Affero General Public License v3.0 (`AGPL-3.0-only`)

## Local modifications

### Adapt the emoji picker to wide custom emojis

Files:

- `packages/frontend/src/components/MkEmojiPicker.vue`
- `packages/frontend/src/components/MkEmojiPicker.section.vue`

After a custom emoji image loads, the picker measures its aspect ratio and
uses between one and four grid columns. Wide emoji artwork is therefore shown
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

## Build and configuration

Follow the upstream installation and build instructions for Misskey 2026.9.0.
Runtime configuration and secrets are deliberately not included in this
repository. In particular, `.config/default.yml`, environment files,
credentials, uploaded files, and database contents must remain private.

The complete local code changes can be reviewed by comparing this source tree
with the upstream commit shown above.
