import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleServiceRequest, handleServiceRequestConfig } from '../service-request-api.js';

const nativeFetch = globalThis.fetch;
const env = {
  ZOHO_CLIENT_ID: 'test-client', ZOHO_CLIENT_SECRET: 'test-secret',
  ZOHO_REFRESH_TOKEN: 'test-refresh', TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
  TURNSTILE_SITE_KEY: 'test-public-key',
};
let calls, mail, uploadedNames, failVerification, failUpload, failSend;

beforeEach(() => {
  calls = []; mail = null; uploadedNames = [];
  failVerification = false; failUpload = false; failSend = false;
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/siteverify')) {
      assert.equal(init.body.get('secret'), env.TURNSTILE_SECRET_KEY);
      return Response.json({ success: !failVerification });
    }
    if (String(url).endsWith('/oauth/v2/token')) return Response.json({ access_token: 'mock-access' });
    if (String(url).endsWith('/accounts')) return Response.json({ data: [{ accountId: 'mock-account', primaryEmailAddress: 'info@white5.ca', sendMailDetails: [{ fromAddress: 'website@white5.ca' }] }] });
    if (String(url).includes('/messages/attachments?')) {
      assert.ok(init.body instanceof FormData);
      assert.equal(init.headers['content-type'], undefined, 'Runtime must supply the multipart boundary');
      uploadedNames.push(init.body.get('attach').name);
      return failUpload ? Response.json({ error: 'upload failed' }, { status: 502 }) : Response.json({ data: [{ storeName: 'mock-store', attachmentPath: '/mock-path', attachmentName: 'photo.jpg' }] });
    }
    if (String(url).endsWith('/messages')) {
      mail = JSON.parse(init.body);
      return failSend ? Response.json({ status: { code: 500 } }, { status: 500 }) : Response.json({ status: { code: 200 }, data: { messageId: 'mock-message' } });
    }
    throw new Error(`Unexpected network request: ${url}`);
  };
});
afterEach(() => { globalThis.fetch = nativeFetch; });

const base = {
  name: 'Test Customer', address: '123 Test Street, Calgary',
  email: 'customer@example.test', phone: '', services: ['Window Cleaning'],
  details: 'Exterior windows and screens', notes: 'Please include screens.',
  consent: true, turnstileToken: 'mock-token',
};
function jsonRequest(fields = {}) {
  return new Request('https://www.white5.ca/api/service-request', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://www.white5.ca' },
    body: JSON.stringify({ ...base, ...fields }),
  });
}
function multipartRequest(overrides = {}, photos = []) {
  const fields = { ...base, consent: 'yes', ...overrides };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
  }
  for (const photo of photos) form.append('photos', photo);
  return new Request('https://www.white5.ca/api/service-request', {
    method: 'POST', headers: { origin: 'https://www.white5.ca' }, body: form,
  });
}
function photo(name = 'window.png') {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1cAAAAASUVORK5CYII=', 'base64');
  return new File([bytes], name, { type: 'image/png' });
}

test('existing JSON estimates retain their price and delivery format', async () => {
  const response = await handleServiceRequest(jsonRequest({ estimate: 190 }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(mail.toAddress, 'info@white5.ca');
  assert.equal(mail.fromAddress, 'website@white5.ca');
  assert.match(mail.content, /Estimated starting price: \$190/);
  assert.equal(mail.attachments, undefined);
});

test('new personal estimates do not invent a zero-dollar price', async () => {
  const response = await handleServiceRequest(multipartRequest(), env);
  assert.equal(response.status, 200);
  assert.match(mail.content, /Personal estimate requested/);
  assert.doesNotMatch(mail.content, /Estimated starting price|\$0/);
  assert.match(mail.content, /customer@example.test/);
});

test('phone-only requests work without requiring email', async () => {
  const response = await handleServiceRequest(multipartRequest({ email: '', phone: '403-555-0123' }), env);
  assert.equal(response.status, 200);
  assert.match(mail.content, /Phone: 403-555-0123/);
  assert.match(mail.content, /Email: Not provided/);
});

test('optional photos are uploaded and included in the delivered lead', async () => {
  const response = await handleServiceRequest(multipartRequest({}, [photo('my window (1).png'), photo('second.png')]), env);
  assert.equal(response.status, 200);
  assert.deepEqual(uploadedNames, ['my-window--1-.png', 'second.png']);
  assert.equal(mail.attachments.length, 2);
  assert.deepEqual(mail.attachments[0], { storeName: 'mock-store', attachmentPath: '/mock-path', attachmentName: 'photo.jpg' });
});

test('contact consent is required before any external request', async () => {
  const response = await handleServiceRequest(multipartRequest({ consent: 'no' }), env);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('failed spam protection never attempts mail delivery', async () => {
  failVerification = true;
  const response = await handleServiceRequest(jsonRequest(), env);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
  assert.equal(mail, null);
});

test('photo upload failure does not send an incomplete request or claim success', async () => {
  failUpload = true;
  const response = await handleServiceRequest(multipartRequest({}, [photo()]), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).ok, false);
  assert.equal(mail, null);
});

test('mail provider rejection is returned as failure', async () => {
  failSend = true;
  const response = await handleServiceRequest(jsonRequest(), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).ok, false);
});

test('too many photos are rejected before upload', async () => {
  const response = await handleServiceRequest(multipartRequest({}, Array.from({ length: 6 }, () => photo())), env);
  assert.equal(response.status, 400);
  assert.equal(uploadedNames.length, 0);
  assert.equal(mail, null);
});

test('file contents must match an allowed image signature', async () => {
  const invalid = new File(['not an image'], 'fake.png', { type: 'image/png' });
  const response = await handleServiceRequest(multipartRequest({}, [invalid]), env);
  assert.equal(response.status, 400);
  assert.equal(uploadedNames.length, 0);
});

test('oversized bodies without Content-Length are bounded', async () => {
  const request = jsonRequest({ notes: 'x'.repeat(26000) });
  assert.equal(request.headers.has('content-length'), false);
  const response = await handleServiceRequest(request, env);
  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});

test('cross-origin submissions are rejected', async () => {
  const request = jsonRequest();
  request.headers.set('origin', 'https://other.example');
  const response = await handleServiceRequest(request, env);
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('malformed JSON payloads return an error instead of throwing', async () => {
  const request = new Request('https://www.white5.ca/api/service-request', { method: 'POST', body: 'null' });
  const response = await handleServiceRequest(request, env);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('configuration returns only the configured public key and never substitutes a preview bypass', async () => {
  const response = handleServiceRequestConfig(new Request('https://preview.white5-website.pages.dev/api/service-request-config'), env);
  assert.deepEqual(await response.json(), { ok: true, turnstileSiteKey: 'test-public-key' });
  const missing = handleServiceRequestConfig(new Request('https://www.white5.ca/api/service-request-config'), {});
  assert.equal(missing.status, 503);
});
