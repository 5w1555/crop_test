import test from 'node:test';
import assert from 'node:assert/strict';
import { mapDiagnosticsToErrorMessage } from '../components/crop/apiClient.js';

test('maps auth errors', () => {
  const message = mapDiagnosticsToErrorMessage({ status: 401, contentType: 'application/json' });
  assert.match(message, /Authentication expired/);
});

test('maps edge timeout errors', () => {
  const message = mapDiagnosticsToErrorMessage({ status: 524, contentType: 'text/html', textSnippet: 'cloudflare timeout' });
  assert.match(message, /timed out/);
});

test('maps generic request failure', () => {
  const message = mapDiagnosticsToErrorMessage({ status: 422, contentType: 'application/json' });
  assert.equal(message, 'Request failed (422). Please retry.');
});
