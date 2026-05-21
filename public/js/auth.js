import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "COLE_AQUI",
  projectId: "COLE_AQUI",
  storageBucket: "COLE_AQUI",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const googleLoginBtn = document.getElementById("googleLoginBtn");

window.currentUser = null;

onAuthStateChanged(auth, (user) => {
  window.currentUser = user || null;

  if (!googleLoginBtn) return;

  if (user) {
    googleLoginBtn.innerHTML = `
      <img src="${user.photoURL}" alt="Foto do perfil" class="google-user-photo">
      <span>Conectado: ${user.displayName}</span>
    `;
    googleLoginBtn.classList.add("connected");
  } else {
    googleLoginBtn.innerHTML = `Entrar com Google`;
    googleLoginBtn.classList.remove("connected");
  }
});

if (googleLoginBtn) {
  googleLoginBtn.addEventListener("click", async () => {
    if (window.currentUser) {
      const sair = confirm("Você já está conectado. Deseja sair da conta?");
      if (sair) await signOut(auth);
      return;
    }

    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Erro ao fazer login com Google:", error);
      alert("Não foi possível entrar com Google. Tente novamente.");
    }
  });
}

window.requireLogin = function () {
  if (!window.currentUser) {
    alert("Você precisa entrar com Google para acessar as mesas do ResenhaON.");
    return false;
  }

  return true;
};