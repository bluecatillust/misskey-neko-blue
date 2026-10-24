/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const root = path.resolve(process.argv[2] ?? '.');
const endpointPath = 'packages/backend/src/server/api/endpoints/drive/files/detect-image.ts';
const frontendPath = 'packages/frontend/src/utility/detect-drive-image.ts';
const classes = ['Neutral', 'Drawing', 'Hentai', 'Porn', 'Sexy'];
const validPredictions = classes.map((className, index) => ({ className, probability: [0.5159675, 0.4374362, 0.0333663, 0.0096434, 0.0035865][index] }));
let passed = 0;

function compile(relative, expose, globals) {
  let source = fs.readFileSync(path.join(root, relative), 'utf8');
  source = source.replace(/^import[\s\S]*?;\r?\n/gm, '');
  source = source.replace(/^\s*@Injectable\(\)\s*$/gm, '');
  source = source.replace(/^\s*@Inject\([^\n]*\)\s*$/gm, '');
  source = source.replace('export default class extends', 'const DetectorEndpoint = class extends');
  source = source.replace(/^export /gm, '');
  // Prefer the project's compiler. Node.js 26 removed the built-in transform mode.
  let ts;
  try { ts = createRequire(path.join(root, 'package.json'))('typescript'); } catch { /* Standalone test package on Node.js 24. */ }
  if (ts) {
    source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  } else {
    source = stripTypeScriptTypes(source, { mode: 'transform' });
  }
  const sandbox = { ...globals, module: { exports: {} }, console, Buffer, AbortSignal };
  vm.runInNewContext(`${source}\nmodule.exports = { ${expose} };`, sandbox, { filename: relative });
  return sandbox.module.exports;
}

class ApiError extends Error {
  constructor(error) { super(error.message); this.code = error.code; }
}
class Endpoint { constructor(meta, params, handler) { this.handler = handler; } }

function backend(options = {}) {
  const calls = [];
  const file = { id: 'image', userId: 'owner', userHost: null, type: 'image/png', size: 123, storedInternal: true, accessKey: 'original', url: 'https://storage.example/original', isSensitive: true, ...options.file };
  const image = {
    metadata: async () => ({ width: 100, height: 100, pages: 1, ...options.metadata }),
    resize(...args) { calls.push(['resize', ...args]); return this; },
    rotate() { calls.push(['rotate']); return this; },
    flatten(...args) { calls.push(['flatten', ...args]); return this; },
    png() { return this; },
    toBuffer: async () => Buffer.from('normalized'),
  };
  const { DetectorEndpoint, meta } = compile(endpointPath, 'DetectorEndpoint, meta', {
    Endpoint, ApiError,
    fs: { promises: { stat: async () => ({ size: options.actualSize ?? 123 }) } },
    sharpBmp: async () => image,
    createTemp: async () => ['/tmp/image-test', () => calls.push(['cleanup'])],
  });
  const repo = { findOneBy: async () => options.missing ? null : file };
  const endpoint = new DetectorEndpoint(
    repo, { sensitiveMediaDetectionApiUrl: options.unconfigured ? '' : 'http://127.0.0.1:3009' },
    { detectType: async () => ({ mime: options.actualType ?? 'image/png' }) },
    { resolvePath: key => { calls.push(['local', key]); return '/files/original'; } },
    { downloadUrl: async (...args) => { calls.push(['download', ...args]); if (options.downloadFails) throw new Error('download failed'); } },
    { detectSensitive: async data => { calls.push(['detect', data.toString()]); if (options.detectThrows) throw new Error('network failure'); return options.predictions === undefined ? validPredictions : options.predictions; } },
  );
  return { run: () => endpoint.handler({ fileId: 'image' }, { id: 'owner' }), calls, file, meta };
}

async function test(name, fn) {
  await fn(); passed++; console.log(`PASS ${name}`);
}
async function rejects(options, code) {
  const ctx = backend(options);
  await assert.rejects(ctx.run(), error => error.code === code);
  return ctx;
}

await test('local image returns five ordered finite scores without updating flags', async () => {
  const ctx = backend();
  const before = JSON.stringify(ctx.file);
  const result = await ctx.run();
  assert.equal(JSON.stringify(result.predictions), JSON.stringify(validPredictions));
  assert.equal(JSON.stringify(ctx.file), before);
  assert.equal(ctx.calls.some(call => call[0] === 'download'), false);
  assert.equal(ctx.meta.requireCredential, true);
  assert.equal(ctx.meta.limit.max, 3);
  assert.equal(ctx.meta.limit.duration, 60000);
  assert.equal(JSON.stringify(ctx.calls.find(call => call[0] === 'resize')), JSON.stringify(['resize', 299, 299, { withoutEnlargement: false }]));
  assert.equal(JSON.stringify(ctx.calls.find(call => call[0] === 'flatten')), JSON.stringify(['flatten', { background: { r: 119, g: 119, b: 119 } }]));
});
await test('unknown file fails', () => rejects({ missing: true }, 'NO_SUCH_FILE'));
await test('another owner is rejected before image access', async () => {
  const ctx = await rejects({ file: { userId: 'another-user' } }, 'ACCESS_DENIED');
  assert.equal(ctx.calls.length, 0);
});
await test('remote owner is rejected', () => rejects({ file: { userHost: 'remote.example' } }, 'ACCESS_DENIED'));
for (const type of ['video/mp4', 'image/gif', 'image/apng', 'image/vnd.mozilla.apng', 'application/pdf']) {
  await test(`unsupported declared type ${type}`, () => rejects({ file: { type } }, 'UNSUPPORTED_IMAGE'));
}
await test('actual bytes override declared MIME', () => rejects({ actualType: 'image/gif' }, 'UNSUPPORTED_IMAGE'));
await test('animated WebP is rejected', () => rejects({ file: { type: 'image/webp' }, actualType: 'image/webp', metadata: { pages: 2 } }, 'UNSUPPORTED_IMAGE'));
await test('declared file size limit', () => rejects({ file: { size: 20 * 1024 * 1024 + 1 } }, 'IMAGE_TOO_LARGE'));
await test('actual file size limit', () => rejects({ actualSize: 20 * 1024 * 1024 + 1 }, 'IMAGE_TOO_LARGE'));
await test('pixel limit', () => rejects({ metadata: { width: 10000, height: 10000 } }, 'IMAGE_TOO_LARGE'));
await test('missing detector configuration', () => rejects({ unconfigured: true }, 'DETECTOR_UNAVAILABLE'));
await test('no result is a failure, not five zero scores', () => rejects({ predictions: null }, 'IMAGE_DETECTION_FAILED'));
await test('missing class is a failure', () => rejects({ predictions: validPredictions.slice(1) }, 'IMAGE_DETECTION_FAILED'));
await test('NaN score is a failure', () => rejects({ predictions: validPredictions.map(p => ({ ...p, probability: NaN })) }, 'IMAGE_DETECTION_FAILED'));
await test('out of range score is a failure', () => rejects({ predictions: validPredictions.map(p => ({ ...p, probability: 2 })) }, 'IMAGE_DETECTION_FAILED'));
await test('downloaded original is cleaned after success', async () => {
  const ctx = backend({ file: { storedInternal: false } }); await ctx.run();
  assert.ok(ctx.calls.find(call => call[0] === 'download' && call[1] === ctx.file.url));
  assert.equal(ctx.calls.at(-1)[0], 'cleanup');
});
await test('temporary file is cleaned after download failure', async () => {
  const ctx = await rejects({ file: { storedInternal: false }, downloadFails: true }, 'IMAGE_DETECTION_FAILED');
  assert.equal(ctx.calls.at(-1)[0], 'cleanup');
});
await test('temporary file is cleaned after detection failure', async () => {
  const ctx = await rejects({ file: { storedInternal: false }, detectThrows: true }, 'IMAGE_DETECTION_FAILED');
  assert.equal(ctx.calls.at(-1)[0], 'cleanup');
});

function frontend(options = {}) {
  const calls = [];
  const latest = { id: 'image', type: 'image/png', isSensitive: true };
  const os = {
    waiting(props) { calls.push(['waiting', props]); return () => calls.push(['done']); },
    async actions(props) { calls.push(['actions', props]); return options.action ?? { canceled: false, result: 'close' }; },
    async post(props) { calls.push(['post', props]); },
    async alert(props) { calls.push(['alert', props]); },
  };
  const api = async (route, data) => {
    calls.push(['api', route, data]);
    if (options.error) throw options.error;
    return route === 'drive/files/show' ? latest : { predictions: validPredictions };
  };
  return { ...compile(frontendPath, 'canDetectDriveImage, detectDriveImage', { os, misskeyApi: api }), calls, latest };
}
await test('video, GIF and APNG are not offered by the menu predicate', async () => {
  const ctx = frontend();
  for (const type of ['video/mp4', 'image/gif', 'image/apng', 'image/vnd.mozilla.apng']) {
    assert.equal(ctx.canDetectDriveImage({ type }), false);
    await ctx.detectDriveImage({ id: 'image', type });
  }
  assert.equal(ctx.calls.length, 0);
});
await test('acknowledge closes without opening the composer', async () => {
  const ctx = frontend(); await ctx.detectDriveImage({ id: 'image', type: 'image/png' });
  assert.equal(ctx.calls.some(call => call[0] === 'post'), false);
  const props = ctx.calls.find(call => call[0] === 'actions')[1];
  assert.equal(props.title, '画像判定結果（機械学習による参考値）');
  assert.equal(props.text, 'Neutral(一般的) 51.60%\nDrawing(イラスト) 43.74%\nHentai(性的イラスト) 3.34%\nPorn(ポルノ) 0.96%\nSexy(性的表現) 0.36%');
  assert.equal(props.actions.map(action => action.text).join(','), 'わかった,共有');
});
await test('escape/background close never shares', async () => {
  const ctx = frontend({ action: { canceled: true } });
  await ctx.detectDriveImage({ id: 'image', type: 'image/png' });
  assert.equal(ctx.calls.some(call => call[0] === 'post'), false);
});
await test('share uses the displayed scores and refreshed file sensitive state', async () => {
  const ctx = frontend({ action: { canceled: false, result: 'share' } });
  await ctx.detectDriveImage({ id: 'image', type: 'image/png', isSensitive: false });
  const dialog = ctx.calls.find(call => call[0] === 'actions')[1];
  const post = ctx.calls.find(call => call[0] === 'post')[1];
  assert.equal(post.initialText, `${dialog.title}\n\n${dialog.text}`);
  assert.equal(post.initialFiles[0], ctx.latest);
  assert.equal(post.initialFiles[0].isSensitive, true);
  assert.equal('initialVisibility' in post, false);
  assert.equal(ctx.calls.filter(call => call[0] === 'api' && call[1] === 'drive/files/detect-image').length, 1);
  assert.equal(ctx.calls.some(call => call[0] === 'api' && call[1] === 'notes/create'), false);
});
await test('API failure releases waiting overlay and offers no share', async () => {
  const ctx = frontend({ error: { code: 'IMAGE_DETECTION_FAILED' } });
  await ctx.detectDriveImage({ id: 'image', type: 'image/png' });
  assert.ok(ctx.calls.some(call => call[0] === 'done'));
  assert.ok(ctx.calls.some(call => call[0] === 'alert'));
  assert.equal(ctx.calls.some(call => call[0] === 'actions'), false);
});
await test('rate limit has a readable message', async () => {
  const ctx = frontend({ error: { code: 'RATE_LIMIT_EXCEEDED' } });
  await ctx.detectDriveImage({ id: 'image', type: 'image/png' });
  assert.match(ctx.calls.find(call => call[0] === 'alert')[1].text, /1分間に3回/);
});
await test('concurrent clicks for the same image issue only one analysis', async () => {
  const ctx = frontend();
  await Promise.all([ctx.detectDriveImage({ id: 'image', type: 'image/png' }), ctx.detectDriveImage({ id: 'image', type: 'image/png' })]);
  assert.equal(ctx.calls.filter(call => call[0] === 'api').length, 1);
});

console.log(`\n${passed} tests passed (isolated mocks; full project build and VPS integration are separate).`);
