import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBc5Ds7KENtCR2rjW6CKV0CWpsgQVPfLs8",
  authDomain: "resenhaon-746cb.firebaseapp.com",
  projectId: "resenhaon-746cb",
  storageBucket: "resenhaon-746cb.firebasestorage.app",
  messagingSenderId: "401098344837",
  appId: "1:401098344837:web:d86e6fb1221424f8671cec"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export {
  app,
  auth,
  provider,
  signInWithPopup,
  onAuthStateChanged
};