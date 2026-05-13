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

// UUID v4 generator (no external dependency needed)
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
