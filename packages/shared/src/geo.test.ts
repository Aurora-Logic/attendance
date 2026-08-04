import { describe, expect, it } from "vitest"

import { checkGeofence, distanceMetres, parseGoogleMapsLink } from "./geo"

const HO = { lat: 19.076, lng: 72.8777 }

describe("parseGoogleMapsLink — every URL shape an admin will paste", () => {
  it("@lat,lng map centre", () => {
    const r = parseGoogleMapsLink("https://www.google.com/maps/@19.0760,72.8777,17z")
    expect(r.ok).toBe(true)
    expect(r.coords).toEqual({ lat: 19.076, lng: 72.8777 })
  })

  it("place pin !3d/!4d (wins even when an @ centre is elsewhere on the URL)", () => {
    const r = parseGoogleMapsLink(
      "https://www.google.com/maps/place/Delta/@19.07,72.87,17z/data=!3m1!4b1!3d19.0760!4d72.8777"
    )
    expect(r.ok).toBe(true)
  })

  it("?q= and ?ll= and api=1&query=", () => {
    expect(parseGoogleMapsLink("https://maps.google.com/?q=19.0760,72.8777").ok).toBe(true)
    expect(parseGoogleMapsLink("https://maps.google.com/?ll=19.0760,72.8777").ok).toBe(true)
    expect(
      parseGoogleMapsLink("https://www.google.com/maps/search/?api=1&query=19.0760,72.8777").ok
    ).toBe(true)
  })

  it("bare coordinates pasted from the info panel", () => {
    const r = parseGoogleMapsLink("19.0760, 72.8777")
    expect(r.ok).toBe(true)
  })

  it("short links are refused with an actionable message — they carry no coordinates", () => {
    const r = parseGoogleMapsLink("https://maps.app.goo.gl/AbCdEf123")
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/full URL/i)
  })

  it("garbage and 0,0 are refused", () => {
    expect(parseGoogleMapsLink("not a link").ok).toBe(false)
    expect(parseGoogleMapsLink("0.0000, 0.0000").ok).toBe(false)
  })
})

describe("distance + geofence", () => {
  it("known pair: HO to Gateway of India is ~4.5 km", () => {
    const d = distanceMetres(HO, { lat: 18.922, lng: 72.8347 })
    expect(d).toBeGreaterThan(4_000)
    expect(d).toBeLessThan(20_000)
  })

  it("inside / outside / uncertain", () => {
    expect(checkGeofence({ lat: 19.0765, lng: 72.8779 }, HO, 200, 10).inside).toBe(true)
    const far = checkGeofence({ lat: 19.09, lng: 72.9 }, HO, 200, 10)
    expect(far.inside).toBe(false)
    expect(far.uncertain).toBe(false)
  })

  it("GPS accuracy straddling the boundary → uncertain, not asserted-outside", () => {
    // ~220 m away with ±80 m accuracy against a 200 m fence.
    const verdict = checkGeofence({ lat: 19.078, lng: 72.8777 }, HO, 200, 80)
    expect(verdict.inside).toBe(false)
    expect(verdict.uncertain).toBe(true)
    expect(verdict.explanation).toMatch(/cannot be sure/i)
  })

  it("field-employee exemption is the caller's decision — the maths stays honest", () => {
    const verdict = checkGeofence({ lat: 19.2, lng: 73.0 }, HO, 200, 5)
    expect(verdict.inside).toBe(false)
  })
})
