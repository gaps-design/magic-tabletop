(function() {
  const toggles = document.querySelectorAll("[data-mobile-menu-target]");
  const backdrop = document.querySelector("[data-mobile-menu-backdrop]");
  let activeMenu = null;
  let activeToggle = null;

  function closeMobileMenu() {
    if (activeMenu) activeMenu.classList.remove("mobile-menu-open");
    if (activeToggle) activeToggle.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.classList.remove("active");
    document.body.classList.remove("mobile-menu-lock");
    activeMenu = null;
    activeToggle = null;
  }

  function openMobileMenu(toggle, menu) {
    closeMobileMenu();
    activeMenu = menu;
    activeToggle = toggle;
    menu.classList.add("mobile-menu-open");
    toggle.setAttribute("aria-expanded", "true");
    if (backdrop) backdrop.classList.add("active");
    document.body.classList.add("mobile-menu-lock");
  }

  toggles.forEach(toggle => {
    const menu = document.querySelector(toggle.dataset.mobileMenuTarget);
    if (!menu) return;

    if (!menu.querySelector("[data-mobile-menu-close]")) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "mobile-menu-close";
      closeButton.setAttribute("aria-label", "Fechar menu");
      closeButton.setAttribute("data-mobile-menu-close", "");
      closeButton.textContent = "×";
      menu.prepend(closeButton);
    }

    toggle.addEventListener("click", () => {
      if (menu.classList.contains("mobile-menu-open")) {
        closeMobileMenu();
      } else {
        openMobileMenu(toggle, menu);
      }
    });
  });

  document.addEventListener("click", event => {
    if (event.target.closest("[data-mobile-menu-close]")) {
      closeMobileMenu();
    }
  });

  document.querySelectorAll(".top-links a, .top-actions a, .top-actions button").forEach(item => {
    item.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 768px)").matches) {
        closeMobileMenu();
      }
    });
  });

  if (backdrop) backdrop.addEventListener("click", closeMobileMenu);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMobileMenu();
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 768px)").matches) {
      closeMobileMenu();
    }
  });
})();
