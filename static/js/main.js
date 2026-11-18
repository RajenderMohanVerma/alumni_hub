/* ==========================================================================
   Alumni Hub (Minor Project) - main.js
   Small jobs:
     1. Show flash messages as Bootstrap toasts (auto-hide after 4 seconds)
     2. Ask "Are you sure?" before delete / block actions
     3. Scroll the chat box to the latest message
     4. Scroll-in animation: add .visible to .reveal elements when seen
     5. Count-up animation for the home-page statistics (.counter)
     6. Live search: filter cards while typing in the #liveSearch box
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function () {

    // 1) Flash message toasts -------------------------------------------------
    document.querySelectorAll(".toast").forEach(function (el) {
        var toast = new bootstrap.Toast(el, { delay: 4000 });
        toast.show();
    });

    // 2) Confirm before dangerous actions ------------------------------------
    // Any form with class "js-confirm" asks first. The question text comes
    // from the form's data-confirm attribute.
    document.querySelectorAll("form.js-confirm").forEach(function (form) {
        form.addEventListener("submit", function (event) {
            var question = form.getAttribute("data-confirm") || "Are you sure?";
            if (!window.confirm(question)) {
                event.preventDefault();
            }
        });
    });

    // 3) Chat: scroll to the newest message -----------------------------------
    var chatBox = document.getElementById("chat-box");
    if (chatBox) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // 4) Scroll-in animation ---------------------------------------------------
    // IntersectionObserver watches every .reveal element; the first time one
    // enters the screen we add .visible (the CSS does the fade/slide) and
    // stop watching it. If the browser has no IntersectionObserver, we simply
    // show everything at once.
    var revealEls = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && revealEls.length) {
        var revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("visible");
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });
        revealEls.forEach(function (el) { revealObserver.observe(el); });
    } else {
        revealEls.forEach(function (el) { el.classList.add("visible"); });
    }

    // 5) Count-up animation ----------------------------------------------------
    // Elements look like: <span class="counter" data-count="25">25</span>
    // When one scrolls into view, its number animates from 0 up to
    // data-count over about 1.2 seconds. The real number is already in the
    // HTML, so the page is correct even if this code never runs.
    function countUp(el) {
        var target = parseInt(el.getAttribute("data-count"), 10) || 0;
        var duration = 1200;
        var startTime = null;
        function step(now) {
            if (!startTime) startTime = now;
            var progress = Math.min((now - startTime) / duration, 1);
            el.textContent = Math.floor(progress * target);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = target;
            }
        }
        requestAnimationFrame(step);
    }

    var counters = document.querySelectorAll(".counter");
    if ("IntersectionObserver" in window && counters.length) {
        var counterObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    countUp(entry.target);
                    counterObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.4 });
        counters.forEach(function (el) { counterObserver.observe(el); });
    }

    // 6) Live search filter ----------------------------------------------------
    // Pages with a search box id="liveSearch" (Members, Jobs) filter their
    // .filter-item cards instantly while the user types - no page reload.
    // This is only an enhancement: pressing the Search button still sends
    // the form to the server exactly as before.
    var liveSearch = document.getElementById("liveSearch");
    if (liveSearch) {
        liveSearch.addEventListener("input", function () {
            var term = liveSearch.value.trim().toLowerCase();
            document.querySelectorAll(".filter-item").forEach(function (item) {
                var matches = item.textContent.toLowerCase().indexOf(term) !== -1;
                item.style.display = matches ? "" : "none";
            });
        });
    }
});
