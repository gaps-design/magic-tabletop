import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBC5Ds7KENtCR2rjW6CKV0CWpsgQVPfLs8",
  authDomain: "resenhaon-746cb.firebaseapp.com",
  projectId: "resenhaon-746cb",
  storageBucket: "resenhaon-746cb.firebasestorage.app",
  messagingSenderId: "401098344837",
  appId: "1:401098344837:web:d86e6fb1221424f8671cec"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const provider = new GoogleAuthProvider();

const googleLoginBtn = document.getElementById("googleLoginBtn");

window.currentUser = null;

/* =========================
   LOGIN STATE
========================= */

onAuthStateChanged(auth, (user) => {

  window.currentUser = user || null;

  if (!googleLoginBtn) return;

  if (user) {

    googleLoginBtn.innerHTML = `
      <img 
        src="${user.photoURL}" 
        alt="Foto do perfil" 
        class="google-user-photo"
      >

      <span>
        ${user.displayName}
      </span>
    `;

    googleLoginBtn.classList.add("connected");

  } else {

    googleLoginBtn.innerHTML = `
      Entrar com Google
    `;

    googleLoginBtn.classList.remove("connected");
  }
});

/* =========================
   LOGIN BUTTON
========================= */

if (googleLoginBtn) {

  googleLoginBtn.addEventListener("click", async () => {

    if (window.currentUser) {

      const sair = confirm(
        "Você já está conectado. Deseja sair da conta?"
      );

      if (sair) {
        await signOut(auth);

localStorage.clear();

window.currentUser = null;

window.location.href = "/";
      }

      return;
    }

    try {

      await signInWithPopup(auth, provider);

    } catch (error) {

      console.error(
        "Erro ao fazer login com Google:",
        error
      );

      alert(
        "Não foi possível entrar com Google. Tente novamente."
      );
    }
  });
}

/* =========================
   PROTEGER MESAS
========================= */

window.requireLogin = function () {

  if (!window.currentUser) {

    alert(
      "Você precisa entrar com Google para acessar as mesas do ResenhaON."
    );

    return false;
  }

  return true;
};