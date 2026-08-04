import type { AttendanceSettings } from "@attendance/shared"

/**
 * Selfie capture: one video frame → two stamped WebP derivatives (§3 storage
 * decision — the camera original never leaves the device). The date/time/name/
 * location overlay is burned into the pixels; the same values travel as real
 * fields on the punch, because the overlay is for human proof and the fields
 * are for logic. Server-side re-stamping arrives with object storage in
 * Phase 3b.
 */

export interface SelfieDerivatives {
  thumb: string
  view: string
}

interface StampContext {
  name: string
  at: Date
  lat?: number
  lng?: number
}

function drawStamped(
  video: HTMLVideoElement,
  maxPx: number,
  quality: number,
  stamp: StampContext
): string {
  const sourceWidth = video.videoWidth || 640
  const sourceHeight = video.videoHeight || 480
  const scale = Math.min(maxPx / Math.max(sourceWidth, sourceHeight), 1)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")!
  // Selfie cameras mirror the preview; un-mirror the stored image.
  context.translate(width, 0)
  context.scale(-1, 1)
  context.drawImage(video, 0, 0, width, height)
  context.setTransform(1, 0, 0, 1, 0, 0)

  // Legibility floor: skip the text on the thumbnail — at 160px it would be
  // noise. The view derivative carries the proof.
  if (maxPx > 300) {
    const barHeight = Math.max(Math.round(height * 0.12), 34)
    context.fillStyle = "rgba(0,0,0,0.55)"
    context.fillRect(0, height - barHeight, width, barHeight)
    context.fillStyle = "#ffffff"
    const line = Math.round(barHeight / 2.6)
    context.font = `${line}px system-ui, sans-serif`
    const two = (value: number) => String(value).padStart(2, "0")
    const when = `${two(stamp.at.getDate())}-${two(stamp.at.getMonth() + 1)}-${stamp.at.getFullYear()} ${two(stamp.at.getHours())}:${two(stamp.at.getMinutes())}`
    context.fillText(`${stamp.name} · ${when}`, 8, height - barHeight + line + 2)
    context.fillText(
      stamp.lat !== undefined && stamp.lng !== undefined
        ? `${stamp.lat.toFixed(4)}, ${stamp.lng.toFixed(4)}`
        : "location unavailable",
      8,
      height - barHeight + line * 2 + 6
    )
  }

  return canvas.toDataURL("image/webp", quality / 100)
}

export function captureSelfie(
  video: HTMLVideoElement,
  stamp: StampContext,
  settings: AttendanceSettings
): SelfieDerivatives {
  return {
    thumb: drawStamped(video, settings.selfieThumbMaxPx, settings.selfieThumbQuality, stamp),
    view: drawStamped(video, settings.selfieViewMaxPx, settings.selfieViewQuality, stamp),
  }
}
