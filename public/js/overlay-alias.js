(() => {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room") || "";
  const page = window.location.pathname.split("/").pop();
  const map = {
    "overlay-live.html": "scene=live&transparent=1",
    "painel-narrador.html": "scene=live&controls=1",
    "overlay-score.html": "scene=score&transparent=1",
    "overlay-j1.html": "scene=camera-j1&transparent=1",
    "overlay-j2.html": "scene=camera-j2&transparent=1",
    "overlay-facecams.html": "scene=facecams&transparent=1",
    "overlay-chat.html": "scene=chat&transparent=1",
    "overlay-card.html": "scene=card&transparent=1"
  };

  const query = map[page] || "scene=live";
  const next = `/overlay.html?room=${encodeURIComponent(room)}&${query}`;
  window.location.replace(next);
})();
