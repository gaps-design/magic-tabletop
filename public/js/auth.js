import {
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "./firebase.js";

console.log("AUTH.JS CARREGOU");

const loginBtn = document.getElementById("googleLoginBtn");

console.log("BOTÃO LOGIN:", loginBtn);

if (loginBtn) {

  loginBtn.addEventListener("click", async () => {

    console.log("CLICOU NO LOGIN");

    try {

      const result = await signInWithPopup(auth, provider);

      const user = result.user;

      localStorage.setItem("userName", user.displayName);
      localStorage.setItem("userPhoto", user.photoURL);
      localStorage.setItem("userEmail", user.email);

      alert(`Bem-vindo ${user.displayName}`);

      window.location.reload();

    } catch (error) {

      console.error("ERRO LOGIN:", error);

      alert("Erro ao fazer login");

    }

  });

}

onAuthStateChanged(auth, (user) => {

  if (user) {

    console.log("Usuário logado:", user.displayName);

  } else {

    console.log("Usuário não logado");

  }

});