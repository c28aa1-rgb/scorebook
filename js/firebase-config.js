/*
 * Cloud sync settings. With config left null the app runs on this tablet only (no sign-in).
 * With a config, the app requires Google sign-in and syncs everything to Firestore.
 * These values are not secret. Who may sign in is not listed here (this file is public): it's the
 * access/ list in the database, enforced by firestore.rules (see README → Cloud sync).
 */
window.SB_FIREBASE = {
  // The "Dalton Scorebook" web app in the daltrillion-admin Firebase project (shared with Daltrillion,
  // which doesn't use Firestore; the scorebook's data is under books/).
  config: {
    apiKey: 'AIzaSyBCP5yMp2mrjLXzjiiipFrCDakzYcVRPy8',
    authDomain: 'daltrillion-admin.firebaseapp.com',
    projectId: 'daltrillion-admin',
    storageBucket: 'daltrillion-admin.firebasestorage.app',
    messagingSenderId: '26381559698',
    appId: '1:26381559698:web:a0facffa26491de3ef434b'
  },
  // Folder in the database for this team's scorebook.
  book: 'dalton'
};
