// Shared motion for every BloodLink page.
// Everything here is decoration: the pages work fully without it, and
// people who ask for reduced motion get the content without the movement.
(function () {
  "use strict";

  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  root.classList.add("js");

  // Header gets a shadow once the page scrolls.
  var header = document.querySelector(".lp-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Split headings into words (or letters) that rise in.
  // The full text stays available to screen readers in a hidden copy.
  document.querySelectorAll("[data-split]").forEach(function (el) {
    var text = el.textContent.trim().replace(/\s+/g, " ");
    var byChar = el.getAttribute("data-split") === "chars";
    var parts = byChar ? Array.from(text) : text.split(" ");
    var sr = document.createElement("span");
    sr.className = "visually-hidden";
    sr.textContent = text;
    var visual = document.createElement("span");
    visual.setAttribute("aria-hidden", "true");
    parts.forEach(function (part, i) {
      var word = document.createElement("span");
      word.className = "word";
      word.style.setProperty("--i", i);
      var inner = document.createElement("span");
      inner.textContent = part;
      word.appendChild(inner);
      visual.appendChild(word);
      if (!byChar && i < parts.length - 1) visual.appendChild(document.createTextNode(" "));
    });
    el.replaceChildren(sr, visual);
  });

  // Give children of [data-stagger] an index so their reveal is staggered.
  document.querySelectorAll("[data-stagger]").forEach(function (parent) {
    Array.prototype.forEach.call(parent.children, function (child, i) {
      child.style.setProperty("--i", i);
    });
  });

  // Count numbers up from zero: <span data-count="90">90</span>
  function countUp(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (isNaN(target) || reduce) return;
    var start = null;
    var duration = 1400;
    function frame(t) {
      if (start === null) start = t;
      var p = Math.min((t - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(frame);
    }
    el.textContent = "0";
    requestAnimationFrame(frame);
  }

  // Reveal on scroll.
  var revealables = document.querySelectorAll("[data-reveal], [data-observe]");
  function reveal(el) {
    el.classList.add("is-in");
    el.querySelectorAll("[data-count]").forEach(countUp);
    if (el.hasAttribute("data-count")) countUp(el);
  }
  if (reduce || !("IntersectionObserver" in window)) {
    revealables.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -40px 0px" });
    revealables.forEach(function (el) { io.observe(el); });
  }

  // Ripple from the click point on buttons.
  if (!reduce) {
    document.addEventListener("pointerdown", function (e) {
      var btn = e.target.closest(".btn, .lp-btn");
      if (!btn || btn.disabled) return;
      var rect = btn.getBoundingClientRect();
      var dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.left = e.clientX - rect.left + "px";
      dot.style.top = e.clientY - rect.top + "px";
      btn.appendChild(dot);
      dot.addEventListener("animationend", function () { dot.remove(); });
    });
  }

  // Tilt cards toward the pointer.
  if (!reduce && finePointer) {
    document.querySelectorAll("[data-tilt]").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        card.classList.add("is-tilting");
        card.style.transform = "perspective(900px) rotateX(" + (-y * 8).toFixed(2) + "deg) rotateY(" + (x * 10).toFixed(2) + "deg) translateY(-4px)";
      });
      card.addEventListener("pointerleave", function () {
        card.classList.remove("is-tilting");
        card.style.transform = "";
      });
    });
  }

  // Gentle parallax on photos marked [data-parallax].
  var parallax = document.querySelectorAll("[data-parallax]");
  if (!reduce && parallax.length) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var vh = window.innerHeight;
      parallax.forEach(function (img) {
        var r = img.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var progress = (r.top + r.height / 2 - vh / 2) / vh; // -1 .. 1
        img.style.setProperty("--shift", (progress * -40).toFixed(1) + "px");
      });
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // Hero video: pause/play button, and no autoplay for reduced motion.
  var video = document.querySelector(".lp-hero-media");
  var toggle = document.querySelector(".lp-video-toggle");
  if (video && toggle) {
    toggle.hidden = false;
    var sync = function () {
      toggle.setAttribute("aria-label", video.paused ? "Play background video" : "Pause background video");
      toggle.classList.toggle("is-paused", video.paused);
    };
    if (reduce) { video.removeAttribute("autoplay"); video.pause(); }
    toggle.addEventListener("click", function () { video.paused ? video.play() : video.pause(); });
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    sync();
  }
})();
