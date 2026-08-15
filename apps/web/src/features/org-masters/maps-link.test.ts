import { describe, expect, it } from 'vitest';

import { formatCoordinate, parseMapsLink } from './maps-link';

/**
 * Real URLs, copied from what Google actually produces, rather than shapes
 * invented to match the regex. A parser tested only against its own author's
 * idea of a Maps link passes while failing every real one.
 */
describe('reading coordinates out of a pasted Google Maps link', () => {
  it('reads the map centre from a /maps/@ URL', () => {
    expect(parseMapsLink('https://www.google.com/maps/@19.0759837,72.8776559,17z')).toEqual({
      kind: 'found',
      latitude: 19.0759837,
      longitude: 72.8776559,
    });
  });

  it('reads a place URL, and prefers the pin over the map centre', () => {
    // Both are present and they differ. The pin (!3d!4d) is the place; the @
    // pair is wherever the map happened to be scrolled to when it was copied.
    const url =
      'https://www.google.com/maps/place/Gateway+of+India/@18.9219841,72.8301463,17z/data=!3m1!4b1!4m6!3m5!1s0x1234!8m2!3d18.9219841!4d72.8346927';
    expect(parseMapsLink(url)).toEqual({
      kind: 'found',
      latitude: 18.9219841,
      longitude: 72.8346927,
    });
  });

  it('reads the ?q= form', () => {
    expect(parseMapsLink('https://maps.google.com/?q=28.6139,77.2090')).toEqual({
      kind: 'found',
      latitude: 28.6139,
      longitude: 77.209,
    });
  });

  it('reads the ?ll= form', () => {
    expect(parseMapsLink('https://www.google.com/maps?ll=12.9716,77.5946&z=15')).toEqual({
      kind: 'found',
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it('reads two bare numbers, which is what right-click copies', () => {
    expect(parseMapsLink('19.0759837, 72.8776559')).toEqual({
      kind: 'found',
      latitude: 19.0759837,
      longitude: 72.8776559,
    });
  });

  it('reads a southern, western pair', () => {
    // Bare minus signs are where a hand-rolled split on "," goes wrong.
    expect(parseMapsLink('https://www.google.com/maps/@-33.8688,-151.2093,14z')).toEqual({
      kind: 'found',
      latitude: -33.8688,
      longitude: -151.2093,
    });
  });

  it('says what to do about a shortened link instead of calling it invalid', () => {
    const result = parseMapsLink('https://maps.app.goo.gl/xK7dQ2mNpR3vL9sA8');
    expect(result.kind).toBe('short-link');
    // The Share button produces these, so this is the most likely paste of all.
    // "Not a valid link" would send somebody hunting a typo in a correct URL.
    if (result.kind === 'short-link') expect(result.message).toContain('Open it');
  });

  it('treats the older goo.gl/maps form the same way', () => {
    expect(parseMapsLink('https://goo.gl/maps/abc123').kind).toBe('short-link');
  });

  it('refuses 0,0 rather than putting the office in the Atlantic', () => {
    // What a half-matched URL yields. Accepting it silently moves the geofence
    // to the Gulf of Guinea and nobody can punch.
    expect(parseMapsLink('https://www.google.com/maps/@0,0,3z').kind).toBe('unrecognised');
  });

  it('refuses a latitude beyond the poles', () => {
    expect(parseMapsLink('https://www.google.com/maps/@91.5,10.0,17z').kind).toBe('unrecognised');
  });

  it('reports nothing for an empty paste, rather than an error', () => {
    expect(parseMapsLink('   ').kind).toBe('empty');
  });

  it('reports an unrecognised string without pretending to have found something', () => {
    expect(parseMapsLink('our office, second floor').kind).toBe('unrecognised');
  });

  it('is not fooled by a zoom level that looks like a coordinate pair', () => {
    // "17z" trails the pair; a lazy pattern picks up ",17" as a longitude.
    const result = parseMapsLink('https://www.google.com/maps/@19.0759837,72.8776559,17z');
    expect(result).toMatchObject({ longitude: 72.8776559 });
  });
});

describe('showing a coordinate back', () => {
  it('keeps six decimals, which is finer than any phone can fix', () => {
    expect(formatCoordinate(19.07598371234)).toBe('19.075984');
  });

  it('does not pad a round number with noise', () => {
    expect(formatCoordinate(19)).toBe('19');
  });
});
