let _factoryId: string | null = null;

export function setCurrentFactory(id: string) {
  _factoryId = id;
}

export function clearCurrentFactory() {
  _factoryId = null;
}

export function getFactoryId(): string {
  if (!_factoryId) throw new Error('No factory selected — user not logged in or factory not loaded');
  return _factoryId;
}

// Not crypto.randomUUID() — it doesn't exist in Hermes (React Native's JS
// engine) on a real native build, only in a browser/Node's Web Crypto API.
// Every store's add* function calls this as its very first line, so this
// one function throwing synchronously ("property crypto doesn't exist")
// broke every single "add" action app-wide on TestFlight — Investors,
// Clients, and everything else, all from this one shared call. It worked
// fine on the web PWA (a real browser has crypto.randomUUID) and was
// invisible until a caller's own try/catch was added to actually show the
// thrown error instead of swallowing it (see CLAUDE.md, "enqueueIfNetworkError
// never actually implemented its own documented contract"). Same landmine
// already documented and fixed the same way in the sibling Patron app's
// invite-code generation — these are opaque row ids, not security tokens,
// so a plain Math.random()-based UUID v4 is the right fix, not a native
// crypto polyfill dependency.
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
