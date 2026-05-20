import {
  auth,
  provider,
  signInWithPopup,
  onAuthStateChanged
} from "./firebase.js";

console.log("AUTH.JS CARREGOU");

document.addEventListener("DOMContentLoaded", () => {

  const loginBtn = document.getElementById("googleLoginBtn");

  console.log("BOTÃO:", loginBtn);

  if (!loginBtn) return;

  loginBtn.addEventListener("click", async () => {

    console.log("CLICOU LOGIN");

    try {

      const result = await signInWithPopup(auth, provider);

      const user = result.user;

      console.log("LOGADO:", user);

      localStorage.setItem("userName", user.displayName || "");
      localStorage.setItem("userPhoto", user.photoURL || "");
      localStorage.setItem("userEmail", user.email || "");

      alert(`Bem-vindo ${user.displayName}`);

      window.location.reload();

    } catch (error) {

      console.error("ERRO FIREBASE:", error);

      alert(error.message);

    }

  });

});

onAuthStateChanged(auth, (user) => {

  if (user) {

    console.log("Usuário logado:", user.displayName);

  } else {

    console.log("Usuário não logado");

  }

});