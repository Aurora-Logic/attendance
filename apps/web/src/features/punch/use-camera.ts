import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The front camera, and only the front camera (REQ-D-02).
 *
 * There is no `<input type="file">` anywhere in this module and there must
 * never be one. The absence is the control: a gallery picker turns a mandatory
 * live photo into "any image on the phone", which defeats the entire point of
 * photographing the punch. When the camera cannot be used, punching is blocked
 * and the screen says how to fix it - it does not offer a way around it.
 *
 * `facingMode: { exact: 'user' }` rather than the non-exact form is deliberate
 * and is what technical design §7 specifies. Without `exact` the browser
 * treats it as a preference and will happily hand back the rear camera, which
 * is the one somebody points at a photograph of a colleague.
 */

export type CameraState = 'starting' | 'ready' | 'denied' | 'unavailable' | 'insecure';

export interface Camera {
  state: CameraState;
  /**
   * A callback ref for the preview element.
   *
   * A callback rather than a RefObject because the panel that renders the
   * `<video>` would otherwise have to read `.current` during render, and
   * because attaching the stream is a side effect that belongs next to the
   * element arriving rather than in an effect that has to guess when it did.
   */
  attachVideo: (element: HTMLVideoElement | null) => void;
  /** A downscaled JPEG (REQ-D-03a), or null when the stream is not ready. */
  capture: () => Promise<Blob | null>;
  /** Re-asks for permission. The browser only re-prompts if it was not denied. */
  retry: () => void;
  /** What went wrong, for the reader, not for the log. */
  detail: string | null;
}

/** NFR-01 and REQ-D-03a: 1280px on the long edge, JPEG quality 0.8. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.8;

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

export function useCamera(): Camera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('starting');
  const [detail, setDetail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (element && streamRef.current) {
      element.srcObject = streamRef.current;
      // Autoplay refusal is not fatal - the stream is attached and the first
      // interaction starts it - so the rejection is dropped rather than
      // blocking the screen.
      void element.play().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start(): Promise<void> {
      // getUserMedia is undefined outside a secure context, which is a
      // different problem with a different fix from a denied permission.
      if (!window.isSecureContext) {
        setState('insecure');
        setDetail('The camera is only available over HTTPS or on localhost.');
        return;
      }
      // The DOM lib types this as always present; a browser without it exists.
      if (!navigator.mediaDevices) {
        setState('unavailable');
        setDetail('This browser does not expose a camera.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'user' } },
          audio: false,
        });
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setState('denied');
          setDetail('Camera access was refused.');
        } else if (name === 'OverconstrainedError') {
          // The device has cameras but none of them reports itself as
          // front-facing. Reported as its own case: "allow the camera" is
          // useless advice to somebody on a desktop with a rear-only webcam.
          setState('unavailable');
          setDetail('This device has no front camera.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setState('unavailable');
          setDetail('No camera was found on this device.');
        } else {
          setState('unavailable');
          setDetail(error instanceof Error ? error.message : 'The camera could not be started.');
        }
        return;
      }

      if (cancelled) {
        stopTracks(stream);
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Autoplay refusal is not fatal - the stream is attached and most
          // browsers start it on the first interaction - so the preview is
          // reported ready rather than the whole screen being blocked.
        }
      }
      if (!cancelled) {
        setState('ready');
        setDetail(null);
      }
    }

    void start();

    return () => {
      cancelled = true;
      // The camera light staying on after navigating away is both alarming and
      // a real privacy failure, so the tracks are stopped, not just detached.
      stopTracks(stream);
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [attempt]);

  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    // HAVE_CURRENT_DATA. Below this there is no frame yet and the canvas would
    // be a black rectangle that looks like a successful capture.
    if (!video || video.readyState < 2 || video.videoWidth === 0) return null;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', JPEG_QUALITY);
    });
  }, []);

  const retry = useCallback(() => {
    setState('starting');
    setDetail(null);
    setAttempt((current) => current + 1);
  }, []);

  return { state, attachVideo, capture, retry, detail };
}
