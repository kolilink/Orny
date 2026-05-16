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

export function generateId(): string {
  return crypto.randomUUID();
}
