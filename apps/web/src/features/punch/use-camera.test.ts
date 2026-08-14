import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCamera } from './use-camera';

/**
 * `hasFrame` is what the punch button is gated on, and it exists because
 * `state` is not enough: the stream stays 'ready' while the `<video>` is
 * unmounted and rebuilt, which is exactly what the confirmation panel does.
 * Measured in a production build before this: the button was enabled at +8ms
 * after "Back to the punch screen" and the first frame arrived at +9ms, so a
 * press in between reached submit, captured null, and queued nothing.
 *
 * jsdom implements no media pipeline, so the two properties `frameReady` reads
 * are defined on the element directly. That is the whole of what is faked -
 * the listener wiring, the remount handling and `capture`'s own refusal are
 * the real ones.
 */

function videoElement(readyState: number, videoWidth: number): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { value: readyState, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: videoWidth, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true });
  return video;
}

function redefine(video: HTMLVideoElement, readyState: number, videoWidth: number): void {
  Object.defineProperty(video, 'readyState', { value: readyState, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: videoWidth, configurable: true });
}

describe('useCamera frame availability', () => {
  it('starts with no frame', () => {
    const { result } = renderHook(() => useCamera());
    expect(result.current.hasFrame).toBe(false);
  });

  it('reports a frame on an element that already has one when it is attached', () => {
    const { result } = renderHook(() => useCamera());
    act(() => {
      result.current.attachVideo(videoElement(4, 640));
    });
    expect(result.current.hasFrame).toBe(true);
  });

  it('holds false until the element actually has data', () => {
    const { result } = renderHook(() => useCamera());
    const video = videoElement(0, 0);

    act(() => {
      result.current.attachVideo(video);
    });
    expect(result.current.hasFrame).toBe(false);

    act(() => {
      redefine(video, 4, 640);
      video.dispatchEvent(new Event('loadeddata'));
    });
    expect(result.current.hasFrame).toBe(true);
  });

  it('waits for a non-zero width, not just for data', () => {
    const { result } = renderHook(() => useCamera());
    const video = videoElement(2, 0);

    act(() => {
      result.current.attachVideo(video);
      video.dispatchEvent(new Event('loadeddata'));
    });
    // Decoded size still unknown: drawing this would be a black rectangle that
    // looks exactly like a successful capture.
    expect(result.current.hasFrame).toBe(false);

    act(() => {
      redefine(video, 2, 640);
      video.dispatchEvent(new Event('resize'));
    });
    expect(result.current.hasFrame).toBe(true);
  });

  it('drops back to false the moment the element is unmounted', () => {
    const { result } = renderHook(() => useCamera());
    act(() => {
      result.current.attachVideo(videoElement(4, 640));
    });
    expect(result.current.hasFrame).toBe(true);

    // What the confirmation panel does: the stream is untouched and still
    // live, and there is nothing to photograph.
    act(() => {
      result.current.attachVideo(null);
    });
    expect(result.current.hasFrame).toBe(false);
  });

  it('stops listening to a detached element, so a stale one cannot report a frame', () => {
    const { result } = renderHook(() => useCamera());
    const first = videoElement(0, 0);

    act(() => {
      result.current.attachVideo(first);
      result.current.attachVideo(null);
    });

    act(() => {
      redefine(first, 4, 640);
      first.dispatchEvent(new Event('loadeddata'));
    });
    expect(result.current.hasFrame).toBe(false);
  });

  it('refuses to capture when there is no frame, rather than returning a black rectangle', async () => {
    const { result } = renderHook(() => useCamera());
    act(() => {
      result.current.attachVideo(videoElement(0, 0));
    });
    await expect(result.current.capture()).resolves.toBeNull();
  });
});

/**
 * The single-camera fallback (P1-5), and the line it must not cross.
 *
 * `facingMode: { exact: 'user' }` is an anti-spoofing control: on a phone the
 * rear camera is the one somebody points at a photograph of a colleague. A
 * laptop webcam reports no facing mode at all, so `exact` refuses it and the
 * punch screen becomes unusable on a device that has no rear camera to abuse.
 *
 * The fallback is therefore allowed on exactly one shape of device - a single
 * video input - and the second test is the one that matters: a device that
 * enumerates two cameras and still cannot name a front one keeps the refusal.
 */
function stubMediaDevices(options: {
  exactFails: boolean;
  cameras: number;
}): { stopped: number; calls: MediaStreamConstraints[] } {
  const record = { stopped: 0, calls: [] as MediaStreamConstraints[] };
  // jsdom serves about:blank, so the hook's secure-context guard would refuse
  // before any of this is reached. The guard itself is tested by its absence
  // elsewhere; here it is the camera path under test.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  const makeStream = () =>
    ({
      getTracks: () => [{ stop: () => { record.stopped += 1; } }],
    }) as unknown as MediaStream;

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: (constraints: MediaStreamConstraints) => {
        record.calls.push(constraints);
        const video = constraints.video as MediaTrackConstraints | undefined;
        const wantsExact =
          typeof video === 'object' && video !== null && typeof video.facingMode === 'object';
        if (wantsExact && options.exactFails) {
          return Promise.reject(new DOMException('no match', 'OverconstrainedError'));
        }
        return Promise.resolve(makeStream());
      },
      enumerateDevices: () =>
        Promise.resolve(
          Array.from({ length: options.cameras }, (_, i) => ({
            kind: 'videoinput',
            deviceId: `cam-${i}`,
          })) as MediaDeviceInfo[],
        ),
    },
  });
  return record;
}

describe('useCamera single-camera fallback (P1-5)', () => {
  it('falls back on a device with exactly one camera, which has no rear camera to abuse', async () => {
    const record = stubMediaDevices({ exactFails: true, cameras: 1 });
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.detail).toBeNull();
    expect(record.stopped).toBe(0);
  });

  it('keeps refusing on a device with two cameras that cannot name a front one', async () => {
    const record = stubMediaDevices({ exactFails: true, cameras: 2 });
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state).toBe('unavailable');
    expect(result.current.detail).toBe('This device has no front camera.');
    // The permissioned stream opened only to count devices must not be left running.
    expect(record.stopped).toBe(1);
  });

  it('asks for the front camera first, and only widens after that is refused', async () => {
    const record = stubMediaDevices({ exactFails: true, cameras: 1 });
    renderHook(() => useCamera());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = record.calls[0]?.video as MediaTrackConstraints;
    expect(first.facingMode).toEqual({ exact: 'user' });
    expect(record.calls).toHaveLength(2);
  });

  it('never widens when the front camera works', async () => {
    const record = stubMediaDevices({ exactFails: false, cameras: 3 });
    const { result } = renderHook(() => useCamera());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state).toBe('ready');
    expect(record.calls).toHaveLength(1);
  });
});
