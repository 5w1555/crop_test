/* eslint-disable react/prop-types */
export default function CropResultPanel({ workflowState, result }) {
  const statusLabel = workflowState.status;

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text fontWeight="semibold">4) Result status</s-text>
        <s-text>Workflow: {statusLabel}</s-text>
        {workflowState.error?.message && <s-text tone="critical">{workflowState.error.message}</s-text>}
        {result?.status && <s-text>Job status: {result.status}</s-text>}
        {result?.jobId && <s-text>Job ID: {result.jobId}</s-text>}
        {result?.cropSummary && (
          <s-text>
            Processed {result.cropSummary.successCount}/{result.cropSummary.requestedCount} successfully.
          </s-text>
        )}
      </s-stack>
    </s-box>
  );
}
