/*
 * Cloud sync settings. With config left null the app runs on this tablet only (no sign-in).
 * Fill config in from Firebase (Project settings → Your apps → SDK setup → Config) to require
 * Google sign-in and sync everything to Firestore. These values are not secret: access is
 * controlled by the sign-in check below and by firestore.rules on the server.
 */
window.SB_FIREBASE = {
  config: null,
  // Google accounts allowed to use the app (firestore.rules must list the same addresses).
  allowed: ['c28aa1@dalton.org'],
  // Folder in the database for this team's scorebook.
  book: 'dalton'
};
