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
   * Whether the preview element is holding a frame this instant.
   *
   * Separate from `state`, and it has to be. `state` describes the stream -
   * permission granted, tracks live - and stays 'ready' while the `<video>`
   * itself is unmounted and rebuilt, which is exactly what happens when the
   * confirmation panel replaces the camera and the person presses "Back to the
   * punch screen". For the moment after that the stream is ready and there is
   * no frame, so a punch would capture nothing.
   */
  hasFrame: boolean;
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

/**
 * A stream from the sole camera on the device, or null when more than one
 * exists (or none can be opened).
 *
 * Only reached after `facingMode: { exact: 'user' }` has already been refused.
 * The device list is enumerated from the granted stream rather than before it,
 * because a browser reports a placeholder list until a camera permission has
 * been given - counting first would read one entry on a phone and hand the
 * fallback to exactly the device it must never reach.
 *
 * The returned stream is the caller's to keep or stop.
 */
async function onlyOneCameraExists(): Promise<MediaStream | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch {
    return null;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    if (cameras.length === 1) return stream;
  } catch {
    // An unreadable device list is not evidence of a single camera.
  }
  stopTracks(stream);
  return null;
}

/**
 * HAVE_CURRENT_DATA and a decoded size. Below either of these the canvas would
 * draw a black rectangle that looks exactly like a successful capture.
 *
 * One predicate, used both to gate the button and to refuse the capture, so
 * the two can never disagree about what "ready to photograph" means.
 */
function frameReady(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return video !== null && video.readyState >= 2 && video.videoWidth > 0;
}

/**
 * The events after which the answer can have changed. `resize` is the one that
 * is easy to leave out and matters: it is what fires when `videoWidth` first
 * becomes non-zero, which on some streams is after `loadeddata`.
 */
const FRAME_EVENTS = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize', 'emptied'];

export function useCamera(): Camera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detachFrameEvents = useRef<(() => void) | null>(null);
  const [state, setState] = useState<CameraState>('starting');
  const [hasFrame, setHasFrame] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    detachFrameEvents.current?.();
    detachFrameEvents.current = null;
    videoRef.current = element;

    if (!element) {
      // The element has gone - the confirmation panel is showing, or the
      // screen is unmounting. There is nothing to photograph until a new one
      // has a frame, whatever the stream is doing.
      setHasFrame(false);
      return;
    }

    const report = (): void => {
      setHasFrame(frameReady(element));
    };
    for (const name of FRAME_EVENTS) element.addEventListener(name, report);
    detachFrameEvents.current = () => {
      for (const name of FRAME_EVENTS) element.removeEventListener(name, report);
    };

    if (streamRef.current) {
      element.srcObject = streamRef.current;
      // Autoplay refusal is not fatal - the stream is attached and the first
      // interaction starts it - so the rejection is dropped rather than
      // blocking the screen.
      void element.play().catch(() => undefined);
    }

    // An element remounted onto a live stream can already have a frame, and
    // then no event ever fires. Asking once here is what covers that.
    report();
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
        if (name === 'OverconstrainedError') {
          // No camera identified itself as front-facing. That is the normal
          // answer from a laptop webcam, which reports no facing mode at all,
          // and `exact` refuses it outright (REQ-D-02, P1-5).
          //
          // The control this protects is anti-spoofing: on a phone, the rear
          // camera is the one somebody points at a photograph of a colleague.
          // So the fallback is allowed on exactly the devices where that
          // camera does not exist - one video input and there is nothing to
          // point anywhere. A phone always enumerates two or more and keeps
          // the hard refusal. Counting is done after a permissioned stream
          // exists, because a browser withholds the device list until then.
          const single = await onlyOneCameraExists();
          if (cancelled) return;
          if (!single) {
            setState('unavailable');
            setDetail('This device has no front camera.');
            return;
          }
          stream = single;
        } else if (name === 'NotAllowedError' || name === 'SecurityError') {
          setState('denied');
          setDetail('Camera access was refused.');
          return;
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setState('unavailable');
          setDetail('No camera was found on this device.');
          return;
        } else {
          setState('unavailable');
          setDetail(error instanceof Error ? error.message : 'The camera could not be started.');
          return;
        }
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
    if (!frameReady(video)) return null;

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

  return { state, hasFrame, attachVideo, capture, retry, detail };
}
