/** Body readers close requests captured before the asynchronous filter engine starts, without replacing transports. */
export function installYouTubeResponseGuard(): void {
  if (typeof window === 'undefined' || window.top !== window) return;
  const { hostname, pathname, protocol, origin } = window.location;
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname.toLowerCase())
    || !['http:', 'https:'].includes(protocol) || pathname === '/tv' || pathname.startsWith('/tv/')) return;
  const marker = Symbol.for('rea.privacy.youtube.response.v1');
  if (Object.prototype.hasOwnProperty.call(window, marker)) return;
  try { Object.defineProperty(window, marker, { value: true }); }
  catch { return; }

  const getDescriptor = Object.getOwnPropertyDescriptor;
  const defineProperty = Object.defineProperty;
  const hasOwn = Object.prototype.hasOwnProperty;
  const json = window.JSON;
  const parse = json?.parse;
  const stringify = json?.stringify;
  const parseURL = window.URL;
  const responsePrototype = window.Response?.prototype;
  const xhrPrototype = window.XMLHttpRequest?.prototype;
  // Text bodies are inspected only up to 2 Mi characters. Each known batch/reel array is limited to
  // 512 items, with at most 2,048 inspected objects per body. There is no recursive DOM or JSON walk.
  const maxTextLength = 2 * 1024 * 1024;
  const maxArrayLength = 512;
  const adFields = ['adPlacements', 'adSlots', 'playerAds'] as const;
  const quotedAdFields = adFields.map(field => `"${field}"`);
  type Endpoint = 'player' | 'reel';
  type ObjectValue = Record<string, unknown>;
  // Native response URLs are immutable strings. Retain only the most recent decision rather than
  // growing a page-wide cache; an XHR reopened with a different URL is evaluated again.
  let lastEndpointURL: string | undefined;
  let lastEndpoint: Endpoint | undefined;

  function object(value: unknown): value is ObjectValue {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function endpoint(value: unknown): Endpoint | undefined {
    if (typeof value !== 'string' || !value || !parseURL) return undefined;
    if (value === lastEndpointURL) return lastEndpoint;
    lastEndpointURL = value;
    lastEndpoint = undefined;
    try {
      const url = new parseURL(value);
      if (url.origin !== origin) return undefined;
      const route = url.pathname.match(/^\/youtubei\/v\d+\/(player|reel\/reel_watch_sequence)\/?$/);
      lastEndpoint = route ? route[1] === 'player' ? 'player' : 'reel' : undefined;
      return lastEndpoint;
    } catch { return undefined; }
  }

  function prune(value: unknown, route: Endpoint): boolean {
    let changed = false;
    let remaining = 2048;
    function player(response: unknown): void {
      if (!object(response) || remaining-- <= 0) return;
      for (const field of adFields) {
        try {
          if (Reflect.apply(hasOwn, response, [field]) && Reflect.deleteProperty(response, field)) changed = true;
        } catch { /* Preserve non-configurable properties returned by another interceptor. */ }
      }
    }
    function entries(holder: ObjectValue): void {
      const items = holder.entries;
      if (!Array.isArray(items) || items.length > maxArrayLength || remaining < items.length * 2) return;
      let kept: unknown[] | undefined;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        remaining--;
        if (object(item) && object(item.command) && object(item.command.reelWatchEndpoint)
          && object(item.command.reelWatchEndpoint.adClientParams)
          && (item.command.reelWatchEndpoint.adClientParams.isAd === true
            || item.command.reelWatchEndpoint.adClientParams.isAd === 1)) {
          // Most responses contain only ordinary videos. Allocate a replacement only when an ad
          // is confirmed, preserving every preceding item and the original array when unchanged.
          kept ??= items.slice(0, index);
          continue;
        }
        kept?.push(item);
        if (object(item)) player(item.playerResponse);
      }
      if (kept) {
        try {
          if (Reflect.set(holder, 'entries', kept)) changed = true;
        } catch { /* Keep a locked response container intact. */ }
      }
    }
    if (Array.isArray(value)) {
      if (value.length <= maxArrayLength) for (const item of value) if (object(item)) player(item.playerResponse);
      return changed;
    }
    if (!object(value)) return false;
    player(value);
    player(value.playerResponse);
    if (route === 'reel') {
      entries(value);
      if (object(value.reelWatchSequenceResponse)) entries(value.reelWatchSequenceResponse);
    }
    return changed;
  }

  function pruneText(value: unknown, route: Endpoint): unknown {
    if (typeof value !== 'string' || value.length > maxTextLength || !parse || !stringify) return value;
    // A missing literal key proves there is nothing to remove only when JSON has no escapes.
    // Any backslash keeps the parser path, including keys such as "ad\\u0053lots".
    if (!value.includes('\\') && !quotedAdFields.some(field => value.includes(field))
      && (route !== 'reel' || !value.includes('"isAd"'))) return value;
    try {
      const parsed: unknown = Reflect.apply(parse, json, [value]);
      return prune(parsed, route) ? Reflect.apply(stringify, json, [parsed]) : value;
    } catch { return value; }
  }

  function pruneObject(value: unknown, route: Endpoint): void {
    try { prune(value, route); }
    catch { /* Exotic values returned by another interceptor retain their original read result. */ }
  }

  if (responsePrototype) {
    const urlGetter = getDescriptor(responsePrototype, 'url')?.get;
    for (const method of ['json', 'text'] as const) {
      const descriptor = getDescriptor(responsePrototype, method);
      if (!descriptor || typeof descriptor.value !== 'function' || !urlGetter) continue;
      const original = descriptor.value;
      try {
        defineProperty(responsePrototype, method, {
          ...descriptor,
          value: function (this: Response, ...args: unknown[]): Promise<unknown> {
            // Call the platform first, retaining its receiver checks, rejected promises and bodyUsed rules.
            const result = Reflect.apply(original, this, args) as Promise<unknown>;
            let route: Endpoint | undefined;
            try { route = endpoint(Reflect.apply(urlGetter, this, [])); }
            catch { return result; }
            if (!route) return result;
            const selected = route;
            return result.then(value => {
              if (method === 'text') return pruneText(value, selected);
              pruneObject(value, selected);
              return value;
            });
          },
        });
      } catch { /* A locked platform method keeps the normal AdGuard fallback. */ }
    }
  }

  if (xhrPrototype) {
    const urlGetter = getDescriptor(xhrPrototype, 'responseURL')?.get;
    const stateGetter = getDescriptor(xhrPrototype, 'readyState')?.get;
    const typeGetter = getDescriptor(xhrPrototype, 'responseType')?.get;
    const textCache = new WeakMap<object, { source: string; result: unknown; route: Endpoint }>();
    for (const property of ['response', 'responseText'] as const) {
      const descriptor = getDescriptor(xhrPrototype, property);
      const original = descriptor?.get;
      if (!descriptor || !original || !urlGetter || !stateGetter || !typeGetter) continue;
      try {
        defineProperty(xhrPrototype, property, {
          ...descriptor,
          get: function (this: XMLHttpRequest): unknown {
            // Preserve Illegal invocation and responseText's InvalidStateError before reading any metadata.
            const result: unknown = Reflect.apply(original, this, []);
            let route: Endpoint | undefined;
            let responseType: string;
            try {
              if (Reflect.apply(stateGetter, this, []) !== 4) return result;
              route = endpoint(Reflect.apply(urlGetter, this, []));
              responseType = Reflect.apply(typeGetter, this, []) as string;
            } catch { return result; }
            if (!route) return result;
            if (property === 'response' && responseType === 'json') {
              pruneObject(result, route);
              return result;
            }
            if (responseType !== '' && responseType !== 'text') return result;
            if (typeof result !== 'string' || result.length > maxTextLength) return result;
            const cached = textCache.get(this);
            if (cached && cached.source === result && cached.route === route) return cached.result;
            const filtered = pruneText(result, route);
            textCache.set(this, { source: result, result: filtered, route });
            return filtered;
          },
        });
      } catch { /* A locked platform getter keeps the normal AdGuard fallback. */ }
    }
  }
}
