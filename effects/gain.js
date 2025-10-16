export default (config, offlineAudioCtx) => {
  const gainNode = offlineAudioCtx.createGain();
  gainNode.gain.value = config.gain.value;
  return gainNode;
};
