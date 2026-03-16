/* eslint-disable react/prop-types */
export default function CropSubmitPanel({ disabled, isSubmitting, selectionCount, onSubmit }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text fontWeight="semibold">3) Submit</s-text>
        <s-text tone="subdued">Selected items: {selectionCount}</s-text>
        <s-button type="button" variant="primary" disabled={disabled} loading={isSubmitting} onClick={onSubmit}>
          Start crop job
        </s-button>
      </s-stack>
    </s-box>
  );
}
