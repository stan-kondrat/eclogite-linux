(function () {
  "use strict";

  var catalog = window.ECLOGITE_CATALOG;

  function updateStatistics() {
    if (!catalog) {
      return;
    }

    var values = {
      packages: catalog.packages.length,
      metapackages: catalog.metapackages.length,
      machines: (catalog.machines || []).length,
      software: (catalog.software || []).length,
      platforms: catalog.platforms.length,
      systems: catalog.systems.length
    };

    document.querySelectorAll("[data-stat]").forEach(function (element) {
      var key = element.getAttribute("data-stat");
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        element.textContent = String(values[key]);
      }
    });
  }

  function setupNavigation() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector(".site-nav");
    if (!toggle || !nav) {
      return;
    }

    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function updateYear() {
    document.querySelectorAll("[data-year]").forEach(function (element) {
      element.textContent = String(new Date().getFullYear());
    });
  }

  updateStatistics();
  setupNavigation();
  updateYear();
}());
