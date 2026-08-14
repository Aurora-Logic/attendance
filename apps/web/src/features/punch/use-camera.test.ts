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
