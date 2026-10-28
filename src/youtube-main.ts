import { installYouTubeResponseGuard } from './youtube-response.ts';

/** Protect initial globals and early API readers; AdGuard owns network, full scriptlet and SSAP filtering. */
export function installYouTubeInitialResponseGuard(): void {
  if (typeof window === 'undefined' || window.top !== window) return;
  const { hostname, pathname, protocol } = window.location;
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname.toLowerCase())
    || !['http:', 'https:'].includes(protocol) || pathname === '/tv' || pathname.startsWith('/tv/')) return;
  installYouTubeResponseGuard();
  const marker = Symbol.for('rea.privacy.youtube.initial-response.v1');
  const page = window as unknown as Record<string | symbol, unknown>;
  if (Object.prototype.hasOwnProperty.call(page, marker)) return;
  Object.defineProperty(page, marker, { value: true });
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const defineProperty = Object.defineProperty;
  const hiddenField = () => undefined;
  const ignoreFieldAssignment = () => undefined;

  function guardFields(value: unknown, fields: readonly string[]): unknown {
    if (value === null || typeof value !== 'object') return value;
    for (const field of fields) {
      try {
        const descriptor = getDescriptor(value, field);
        if (descriptor?.get === hiddenField && descriptor.set === ignoreFieldAssignment) continue;
        if (descriptor && !descriptor.configurable) {
          if ('value' in descriptor && descriptor.writable) Reflect.set(value, field, undefined);
          continue;
        }
        defineProperty(value, field, {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get: hiddenField,
          set: ignoreFieldAssignment,
        });
      } catch {
        // Frozen or exotic response objects remain under the native engine's ownership.
      }
    }
    return value;
  }

  function guardGlobal(property: string, fields: readonly string[]): void {
    try {
      const descriptor = getDescriptor(page, property);
      if (descriptor && !descriptor.configurable) {
        guardFields(Reflect.get(page, property), fields);
        return;
      }
      let current = descriptor && 'value' in descriptor ? descriptor.value : Reflect.get(page, property);
      const previousGet = descriptor?.get;
      const previousSet = descriptor?.set;
      guardFields(current, fields);
      defineProperty(page, property, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return guardFields(previousGet ? Reflect.apply(previousGet, page, []) : current, fields);
        },
        set(value: unknown) {
          guardFields(value, fields);
          if (previousSet) Reflect.apply(previousSet, page, [value]);
          else if (!descriptor || !('value' in descriptor) || descriptor.writable) current = value;
        },
      });
    } catch {
      // A page that locks its own global keeps the native filtering fallback.
    }
  }

  guardGlobal('ytInitialPlayerResponse', ['adPlacements', 'adSlots', 'playerAds']);
  guardGlobal('playerResponse', ['adPlacements']);
}

