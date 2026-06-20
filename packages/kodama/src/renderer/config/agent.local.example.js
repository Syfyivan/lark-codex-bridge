// Copy to agent.local.js (gitignored) to point Kodama at a non-default bridge,
// e.g. if you changed BRIDGE_HTTP_PORT or run the bridge elsewhere on loopback.
export const AGENT = {
  bridgeUrl: 'http://127.0.0.1:8787',
  // token: '...', // only if your bridge requires a token on /pet/events
}
