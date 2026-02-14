import { AmbientObserver } from './observer.js';

export const ambientObserver = new AmbientObserver();

export function initAmbient(): void {
  console.log('[ambient] Ambient observer initialized');
}
