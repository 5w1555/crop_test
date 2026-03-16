/* eslint-disable react/prop-types */
export default function PresetSelector({ presets, selectedPreset, onChange }) {
  const selectedConfig = presets.find((preset) => preset.value === selectedPreset) || presets[0];

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text fontWeight="semibold">2) Choose preset</s-text>
        <label htmlFor="preset">Preset</label>
        <select id="preset" value={selectedPreset} onChange={(event) => onChange(event.currentTarget.value)}>
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
        </select>
        <s-text tone="subdued">{selectedConfig.description}</s-text>
      </s-stack>
    </s-box>
  );
}
