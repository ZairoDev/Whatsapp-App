export const focusEffectState: {
  latest: (() => void | (() => void)) | null;
} = {
  latest: null,
};

export function runLatestFocusEffect() {
  focusEffectState.latest?.();
}
