// The game code was written for the browser; give it harmless stand-ins for the
// few browser globals it touches while loading. Nothing here renders anything.
const noop = () => {};
const stub = () => new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()),
  apply: () => stub(),
  construct: () => stub(),
});
const g = globalThis;
const store = new Map();
g.window ??= g;
g.document ??= stub();
g.location ??= { hostname: 'localhost', host: 'localhost', protocol: 'http:', search: '', href: 'http://localhost/', replace: noop };
g.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
g.matchMedia ??= () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
g.requestAnimationFrame ??= (f) => setTimeout(() => f(performance.now()), 16);
g.cancelAnimationFrame ??= clearTimeout;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.innerWidth ??= 1280;
g.innerHeight ??= 720;
g.devicePixelRatio ??= 1;
globalThis.navigator ??= { language: 'vi', userAgent: 'node' };
