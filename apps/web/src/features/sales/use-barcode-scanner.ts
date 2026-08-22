import { useEffect, useRef, useState } from 'react';

/**
 * Reads a Code 128 or QR from the phone's camera into a string (D-47).
 *
 * Android Chrome has a native BarcodeDetector; iPhone Safari does not, so
 * the approved fallback (@zxing/browser) is loaded only there, and only on
 * this screen — nobody else pays for it. The hook owns the camera stream and
 * stops it when the screen leaves or a code is read; the video element is
 * the caller's, so the layout is the screen's business.
 */

type ScannerState = 'starting' | 'scanning' | 'found' | 'denied' | 'unsupported';

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface NativeDetectorCtor {
  new (options: { formats: string[] }): NativeDetector;
}

function nativeDetector(): NativeDetector | null {
  const ctor: NativeDetectorCtor | undefined = (window as Window & { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (ctor === undefined) return null;
  try {
    const detector: NativeDetector = new ctor({ formats: ['code_128', 'qr_code'] });
    return detector;
  } catch {
    return null;
  }
}

export function useBarcodeScanner(onRead: (value: string) => void, active: boolean): { videoRef: React.RefObject<HTMLVideoElement | null>; state: ScannerState } {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<ScannerState>('starting');
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    if (!active) return undefined;
    const video = videoRef.current;
    if (video === null || typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
      setState('unsupported');
      return undefined;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let stopFallback: (() => void) | null = null;

    const finish = (value: string) => {
      if (cancelled) return;
      cancelled = true;
      setState('found');
      onReadRef.current(value.trim());
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setState('denied');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => { t.stop(); });
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setState('scanning');

      const detector = nativeDetector();
      if (detector !== null) {
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            const hit = codes.find((c) => c.rawValue.trim() !== '');
            if (hit !== undefined) {
              finish(hit.rawValue);
              return;
            }
          } catch {
            // A frame that cannot be read is not an error; the next one may be.
          }
          timer = window.setTimeout(() => { void tick(); }, 250);
        };
        void tick();
        return;
      }

      // iPhone Safari: the approved reader, loaded here and nowhere else.
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (cancelled) return;
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (result !== undefined) finish(result.getText());
      });
      stopFallback = () => { controls.stop(); };
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      stopFallback?.();
      stream?.getTracks().forEach((t) => { t.stop(); });
      if (video.srcObject !== null) video.srcObject = null;
    };
  }, [active]);

  return { videoRef, state };
}
