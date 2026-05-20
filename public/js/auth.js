import {
  auth,
  provider,
  signInWithPopup,
  onAuthStateChanged
} from "./firebase.js";

console.log("AUTH.JS CARREGOU");

const loginBtn = document.getElementById("googleLoginBtn");

console.log("BOTÃO LOGIN:", loginBtn);

if (loginBtn) {
  loginBtn.onclick = async () => {
    console.log("CLICOU NO LOGIN");

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      localStorage.setItem("userName", user.displayName || "");
      localStorage.setItem("userPhoto", user.photoURL || "");
      localStorage.setItem("userEmail", user.email || "");

      alert(`Bem-vindo ${user.displayName}`);
      window.location.reload();

    } catch (error) {
      console.error("ERRO LOGIN:", error);
      alert(error.message);
    }
  };
}

onAuthStateChanged(auth, (user) => {
  console.log(user ? "Usuário logado:" : "Usuário não logado", user);
});