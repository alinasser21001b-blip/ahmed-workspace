/**
 * Calyptus Furniture — واجهة الموقع
 * كل البيانات تأتي من js/config.js — لا تحتاج تعديل هذا الملف.
 */
(function () {
  "use strict";

  var CFG = window.CALYPTUS_CONFIG || CALYPTUS_CONFIG;
  var activeCategory = "all";
  var lastFocused = null;

  /* ── صورة بديلة إذا لم تُرفع صورة المنتج بعد ── */
  var FALLBACK_IMG =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">' +
        '<rect width="400" height="500" fill="#1a120a"/>' +
        '<rect x="14" y="14" width="372" height="472" fill="none" stroke="#8a6d3a" stroke-width="1" stroke-dasharray="7 7"/>' +
        '<text x="200" y="245" font-family="Georgia,serif" font-size="46" font-style="italic" fill="#c9a961" text-anchor="middle">C</text>' +
        '<text x="200" y="285" font-family="system-ui,sans-serif" font-size="13" letter-spacing="3" fill="#8a6d3a" text-anchor="middle">CALYPTUS</text>' +
        "</svg>"
    );

  /* ── helpers ── */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function byId(id) {
    return document.getElementById(id);
  }
  function setText(id, value) {
    var el = byId(id);
    if (el && value != null && value !== "") el.textContent = value;
  }

  /* ── رابط واتساب ── */
  function waUrl(message) {
    return "https://wa.me/" + CFG.whatsapp.phone + "?text=" + encodeURIComponent(message);
  }

  function buildMessage(name, product) {
    var lines = [(CFG.whatsapp.greeting || "السلام عليكم") + "، أنا " + (name || "زبون كريم")];
    if (product) {
      lines.push("");
      lines.push("أرغب بالاستفسار عن:");
      lines.push("• " + product.name);
      lines.push("• رمز القطعة: " + product.code);
    } else {
      lines.push("");
      lines.push("أرغب بالتواصل معكم بخصوص أثاث Calyptus.");
    }
    if (CFG.promo && CFG.promo.code) {
      lines.push("");
      lines.push("كود الخصم: " + CFG.promo.code);
    }
    return lines.join("\n");
  }

  /* ── المنتجات ── */
  function cardHtml(p) {
    var cat = (CFG.categories.filter(function (c) {
      return c.id === p.category;
    })[0] || {});
    var price = p.priceFrom
      ? esc(p.priceFrom)
      : '<small>تواصل للسعر</small>';

    return (
      '<article class="card reveal">' +
      '<div class="card__media">' +
      '<span class="card__code">' + esc(p.code) + "</span>" +
      '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" width="400" height="500" data-fallback />' +
      "</div>" +
      '<div class="card__body">' +
      '<p class="card__cat">' + esc(cat.labelEn || "") + " · " + esc(cat.label || "") + "</p>" +
      '<h3 class="card__name">' + esc(p.name) + "</h3>" +
      (p.nameEn ? '<p class="card__name-en">' + esc(p.nameEn) + "</p>" : "") +
      (p.desc ? '<p class="card__desc">' + esc(p.desc) + "</p>" : "") +
      (p.material ? '<p class="card__material">' + esc(p.material) + "</p>" : "") +
      '<p class="card__price">' + price + "</p>" +
      '<button class="card__cta" type="button" data-code="' + esc(p.code) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wa" /></svg>' +
      "<span>اطلب عبر واتساب</span>" +
      "</button>" +
      "</div>" +
      "</article>"
    );
  }

  function renderProducts() {
    var grid = byId("products-grid");
    if (!grid) return;
    var list = CFG.products.filter(function (p) {
      return activeCategory === "all" || p.category === activeCategory;
    });
    grid.innerHTML = list.map(cardHtml).join("");
    applyFallbacks(grid);
    observe(grid.querySelectorAll(".reveal"));
  }

  function renderFilters() {
    var box = byId("filters");
    if (!box) return;
    box.innerHTML = CFG.categories
      .map(function (c) {
        return (
          '<button class="filter' + (c.id === activeCategory ? " is-active" : "") +
          '" type="button" data-cat="' + esc(c.id) + '">' + esc(c.label) + "</button>"
        );
      })
      .join("");
  }

  function renderFeatures() {
    var box = byId("features");
    if (!box) return;
    box.innerHTML = CFG.features
      .map(function (f) {
        return (
          '<div class="feature">' +
          "<h3>" + esc(f.title) + "</h3>" +
          (f.titleEn ? '<p class="en">' + esc(f.titleEn) + "</p>" : "") +
          "<p>" + esc(f.text) + "</p>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderGallery() {
    var box = byId("gallery");
    if (!box || !CFG.gallery) return;
    box.innerHTML = CFG.gallery
      .map(function (g) {
        return '<a href="#collection"><img src="' + esc(g.image) + '" alt="' + esc(g.alt) + '" loading="lazy" data-fallback /></a>';
      })
      .join("");
    applyFallbacks(box);
  }

  function renderSocials() {
    var box = byId("socials");
    if (!box) return;
    var defs = [
      { key: "instagram", icon: "i-ig", label: "إنستغرام" },
      { key: "facebook", icon: "i-fb", label: "فيسبوك" },
      { key: "whatsapp", icon: "i-wa", label: "واتساب" },
      { key: "tiktok", icon: "i-tt", label: "تيك توك" }
    ];
    box.innerHTML = defs
      .filter(function (d) {
        return CFG.social[d.key];
      })
      .map(function (d) {
        return (
          '<a class="social" href="' + esc(CFG.social[d.key]) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(d.label) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#' + d.icon + '" /></svg>' +
          "</a>"
        );
      })
      .join("");
  }

  /* صور غير موجودة → شعار بديل بدل أيقونة مكسورة */
  function applyFallbacks(scope) {
    var imgs = scope.querySelectorAll("img[data-fallback]");
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].addEventListener("error", function () {
        if (this.src !== FALLBACK_IMG) this.src = FALLBACK_IMG;
      });
    }
  }

  /* ── تطبيق الإعدادات على العناصر الثابتة ── */
  function applyConfig() {
    var b = CFG.brand, c = CFG.contact;

    setText("hero-est", b.established);
    setText("hero-tagline", b.tagline);
    setText("hero-tagline-en", b.taglineEn);
    setText("hero-desc", b.description);
    setText("c-address", c.address);
    setText("c-phone", c.phoneDisplay);
    setText("c-hours", c.hours);
    setText("c-city", c.addressShort);
    setText("year", new Date().getFullYear());

    var hero = byId("hero-image");
    if (hero && b.heroImage) {
      hero.src = b.heroImage;
      hero.setAttribute("data-fallback", "");
      applyFallbacks(hero.parentNode);
    }

    var phoneRow = byId("c-phone-row");
    if (phoneRow) phoneRow.href = waUrl(buildMessage("", null));

    var maps = byId("maps-link");
    if (maps && c.mapsUrl) maps.href = c.mapsUrl;

    if (CFG.promo && CFG.promo.code) {
      setText("promo-code", CFG.promo.code);
      setText("promo-label", CFG.promo.label);
      byId("promo-bar").hidden = false;
    }
  }

  /* ── النافذة المنبثقة ── */
  var modal, nameInput, currentProduct = null;

  function openModal(code) {
    currentProduct =
      CFG.products.filter(function (p) {
        return p.code === code;
      })[0] || null;

    byId("modal-code").textContent = currentProduct
      ? "Ref. " + currentProduct.code
      : "CALYPTUS · تواصل";
    byId("modal-title").textContent = currentProduct ? currentProduct.name : "تواصل معنا";

    lastFocused = document.activeElement;
    modal.hidden = false;
    modal.classList.add("active");
    setTimeout(function () {
      nameInput.focus();
    }, 60);
  }

  function closeModal() {
    modal.classList.remove("active");
    modal.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function send() {
    var name = (nameInput.value || "").trim();
    window.open(waUrl(buildMessage(name, currentProduct)), "_blank", "noopener,noreferrer");
    closeModal();
  }

  /* ── ظهور تدريجي عند التمرير ──
     شبكة أمان: لا يجوز أن يبقى أي محتوى مخفياً إذا تأخر المراقب أو فشل. */
  var io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0, rootMargin: "200px 0px 200px 0px" }
    );
  }

  function revealAll() {
    var hidden = document.querySelectorAll(".reveal:not(.in)");
    for (var i = 0; i < hidden.length; i++) hidden[i].classList.add("in");
  }

  function observe(nodes) {
    if (!io) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("in");
      return;
    }
    for (var j = 0; j < nodes.length; j++) io.observe(nodes[j]);
  }

  /* أي عنصر لم يظهر خلال ٣ ثوانٍ يُعرض على أي حال */
  setTimeout(revealAll, 3000);
  window.addEventListener("load", function () {
    setTimeout(revealAll, 1200);
  });

  /* ── init ── */
  function init() {
    modal = byId("modal");
    nameInput = byId("customer-name");

    applyConfig();
    renderFilters();
    renderProducts();
    renderFeatures();
    renderGallery();
    renderSocials();
    observe(document.querySelectorAll(".reveal"));

    /* أي زر عليه data-enquire يفتح النافذة */
    document.addEventListener("click", function (e) {
      var enquire = e.target.closest("[data-enquire]");
      if (enquire) {
        e.preventDefault();
        openModal(null);
        return;
      }
      var cta = e.target.closest(".card__cta");
      if (cta) {
        e.preventDefault();
        openModal(cta.getAttribute("data-code"));
        return;
      }
      var filter = e.target.closest(".filter");
      if (filter) {
        activeCategory = filter.getAttribute("data-cat");
        renderFilters();
        renderProducts();
      }
    });

    byId("modal-close").addEventListener("click", closeModal);
    byId("modal-send").addEventListener("click", send);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("active")) closeModal();
    });

    var header = byId("header");
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
