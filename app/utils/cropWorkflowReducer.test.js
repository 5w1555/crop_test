import test from 'node:test';
import assert from 'node:assert/strict';
import { cropWorkflowReducer, initialCropWorkflowState } from '../components/crop/useCropWorkflow.js';

test('crop workflow reducer transitions idle -> submitting -> polling -> success', () => {
  let state = initialCropWorkflowState();
  state = cropWorkflowReducer(state, { type: 'SUBMIT' });
  assert.equal(state.status, 'submitting');

  state = cropWorkflowReducer(state, { type: 'SUBMIT_ACCEPTED', jobId: 'job-1' });
  assert.equal(state.status, 'polling');
  assert.equal(state.jobId, 'job-1');

  const result = { ok: true };
  state = cropWorkflowReducer(state, { type: 'POLL_SUCCESS', result });
  assert.equal(state.status, 'success');
  assert.deepEqual(state.result, result);
});

test('crop workflow reducer transitions to failure and reset', () => {
  let state = initialCropWorkflowState();
  state = cropWorkflowReducer(state, { type: 'SUBMIT' });
  state = cropWorkflowReducer(state, { type: 'SUBMIT_ACCEPTED', jobId: 'job-2' });

  const error = { message: 'boom' };
  state = cropWorkflowReducer(state, { type: 'POLL_FAILURE', error });
  assert.equal(state.status, 'failure');
  assert.deepEqual(state.error, error);

  state = cropWorkflowReducer(state, { type: 'RESET' });
  assert.equal(state.status, 'idle');
  assert.equal(state.jobId, null);
});
