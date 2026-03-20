import { useState, useCallback } from 'react';

export function useScreenshot() {
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const captureScreenshot = useCallback(async () => {
    setIsCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => { video.play(); resolve(); };
      });
      await new Promise(r => setTimeout(r, 500));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/png');
      stream.getTracks().forEach(track => track.stop());
      setPendingScreenshot(imageData);
    } catch (err) {
      console.error('Screenshot failed:', err);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  const clearScreenshot = useCallback(() => {
    setPendingScreenshot(null);
  }, []);

  return { pendingScreenshot, isCapturing, captureScreenshot, clearScreenshot };
}
