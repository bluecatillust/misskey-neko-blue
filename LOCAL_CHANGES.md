# neko.blue local changes

This public repository contains the corresponding source code for the modified
Misskey version used by `neko.blue`.

## Base version

- Upstream project: <https://github.com/misskey-dev/misskey>
- Misskey version: `2026.6.0`
- Upstream commit: `2954dee1081e601b50b372d7a39e9be361a7c774`
- License: GNU Affero General Public License v3.0 (`AGPL-3.0-only`)

## Local modifications

### Respect the configured outgoing address family

File:
`packages/backend/src/core/HttpRequestService.ts`

The HTTP and HTTPS agents now receive a Node.js `family` value derived from
Misskey's `outgoingAddressFamily` setting. This makes `ipv4`, `ipv6`, and
`dual` select family `4`, `6`, and `0` respectively, and fixes remote image
fetching on hosts where the automatically selected address family is not
usable.

### Reuse a matching local emoji for a remote reaction

File:
`packages/frontend/src/components/MkReactionsViewer.reaction.vue`

When a displayed remote custom-emoji reaction has the same name as an emoji
installed locally, clicking it sends the matching local emoji reaction. A
remote reaction without a same-named local emoji remains unavailable.

### React from matching emojis in remote note text

File:
`packages/frontend/src/components/global/MkMfm.ts`

For a custom emoji displayed in the body of a remote note, the emoji menu now
offers the existing reaction action when an emoji with the same name is
installed locally. The reaction uses the local emoji; if no same-named local
emoji exists, the action remains unavailable as before.

## Build and configuration

Follow the upstream installation and build instructions for Misskey 2026.6.0.
Runtime configuration and secrets are deliberately not included in this
repository. In particular, `.config/default.yml`, environment files,
credentials, uploaded files, and database contents must remain private.

The complete local code changes can be reviewed by comparing this source tree
with the upstream commit shown above.
