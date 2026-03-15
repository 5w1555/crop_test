import { useCallback, useMemo, useReducer } from "react";

export const CROP_WORKFLOW_STATES = {
  IDLE: "idle",
  SUBMITTING: "submitting",
  POLLING: "polling",
  SUCCESS: "success",
  FAILURE: "failure",
};

export function cropWorkflowReducer(state, event) {
  switch (event.type) {
    case "SUBMIT":
      return { status: CROP_WORKFLOW_STATES.SUBMITTING, jobId: null, error: null, result: null };
    case "SUBMIT_ACCEPTED":
      return { ...state, status: CROP_WORKFLOW_STATES.POLLING, jobId: event.jobId };
    case "POLL_SUCCESS":
      return { status: CROP_WORKFLOW_STATES.SUCCESS, jobId: state.jobId, error: null, result: event.result };
    case "POLL_FAILURE":
      return { status: CROP_WORKFLOW_STATES.FAILURE, jobId: state.jobId, error: event.error, result: null };
    case "RESET":
      return initialCropWorkflowState();
    default:
      return state;
  }
}

export function initialCropWorkflowState() {
  return { status: CROP_WORKFLOW_STATES.IDLE, jobId: null, error: null, result: null };
}

export function useCropWorkflow() {
  const [state, dispatch] = useReducer(cropWorkflowReducer, undefined, initialCropWorkflowState);
  const isBusy = useMemo(
    () => state.status === CROP_WORKFLOW_STATES.SUBMITTING || state.status === CROP_WORKFLOW_STATES.POLLING,
    [state.status],
  );

  const beginSubmit = useCallback(() => dispatch({ type: "SUBMIT" }), []);
  const acceptSubmit = useCallback((jobId) => dispatch({ type: "SUBMIT_ACCEPTED", jobId }), []);
  const finishSuccess = useCallback((result) => dispatch({ type: "POLL_SUCCESS", result }), []);
  const finishFailure = useCallback((error) => dispatch({ type: "POLL_FAILURE", error }), []);
  const resetWorkflow = useCallback(() => dispatch({ type: "RESET" }), []);

  return { state, dispatch, isBusy, beginSubmit, acceptSubmit, finishSuccess, finishFailure, resetWorkflow };
}
