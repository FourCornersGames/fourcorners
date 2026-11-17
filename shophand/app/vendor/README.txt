Self-hosted Firebase JS SDK files (no CDN), from the npm package "firebase" 12.0.0 (Apache License 2.0):
  firebase-app-compat.js   from package/firebase-app-compat.js
  firebase-auth-compat.js  from package/firebase-auth-compat.js
Only sign-in uses the SDK. The save is read and written with the Firestore REST API (cloud.js).
To update: npm pack firebase@<version>, extract these two files, copy them here.
