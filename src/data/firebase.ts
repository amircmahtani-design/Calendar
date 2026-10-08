import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager, type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';

export const OWNER_EMAIL = 'amircmahtani@gmail.com';

const useEmulator = import.meta.env.VITE_USE_EMULATOR === '1';

// In emulator mode a dummy config is enough.
const config = useEmulator ? { apiKey: 'demo', authDomain: 'localhost', projectId: 'demo-calendar', appId: 'demo' } : firebaseConfig;

export const configured = !!config && !!config.apiKey;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (configured) {
  app = initializeApp(config!);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    // Offline viewing of previously loaded events; changes queue and sync later.
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

export { app, auth, db, useEmulator };
