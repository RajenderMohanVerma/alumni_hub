/* ==========================================================================
   Alumni Hub - main.js
   Small jobs:
     1. Show flash messages as Bootstrap toasts (auto-hide after 4 seconds)
     2. Ask "Are you sure?" before delete / block actions
     3. Scroll the chat box to the latest message
     4. Scroll-in animation: add .visible to .reveal elements when seen
     5. Count-up animation for the home-page statistics (.counter)
     6. Live search + location chips: filter cards while typing / tapping
     7. Navbar shadow on scroll + "back to top" button
     8. Members page: sort the cards (Name A-Z / Newest first)
     9. Mobile bottom navigation: highlight the current section
    10. PWA: register the service worker + "Install the app" banner
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
    // Templates in this app put class "js-confirm" + data-confirm on the
    // submit BUTTON instead of the form — cover that pattern too: when the
    // clicked button carries a data-confirm question, ask before submitting.
    document.addEventListener("submit", function (event) {
        var form = event.target;
        if (form.classList && form.classList.contains("js-confirm")) {
            return; // already handled by the form-level listener above
        }
        var btn = event.submitter;
        if (btn && btn.getAttribute && btn.getAttribute("data-confirm")) {
            if (!window.confirm(btn.getAttribute("data-confirm"))) {
                event.preventDefault();
            }
        }
    });

    // 3) Chat: scroll to the newest message -----------------------------------
    // (The thread template's scroll area is id="chatBox"; this lookup
    // used to ask for "chat-box", which matched nothing, so the
    // auto-scroll silently never happened.)
    var chatBox = document.getElementById("chatBox");
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

    // 6) Live search + location filter chips -----------------------------------
    // Pages with a search box id="liveSearch" (Members, Jobs) filter their
    // .filter-item cards instantly while the user types - no page reload.
    // On the Jobs page there are also location chips (.filter-chip): a card
    // must match BOTH the typed text AND the active chip to stay visible.
    // When nothing is visible, the page's #noResults line is shown instead.
    var liveSearch = document.getElementById("liveSearch");
    var chips = document.querySelectorAll(".filter-chip");
    if (liveSearch || chips.length) {
        var activeLocation = ""; // "" = the "All locations" chip

        function applyFilters() {
            var term = liveSearch ? liveSearch.value.trim().toLowerCase() : "";
            var visibleCount = 0;
            document.querySelectorAll(".filter-item").forEach(function (item) {
                var matchesText =
                    item.textContent.toLowerCase().indexOf(term) !== -1;
                var matchesChip =
                    !activeLocation ||
                    (item.getAttribute("data-location") || "") === activeLocation;
                var show = matchesText && matchesChip;
                item.style.display = show ? "" : "none";
                if (show) visibleCount++;
            });
            var noResults = document.getElementById("noResults");
            if (noResults) {
                noResults.classList.toggle("d-none", visibleCount !== 0);
            }
        }

        if (liveSearch) {
            liveSearch.addEventListener("input", applyFilters);
        }
        chips.forEach(function (chip) {
            chip.addEventListener("click", function () {
                chips.forEach(function (c) { c.classList.remove("active"); });
                chip.classList.add("active");
                activeLocation = chip.getAttribute("data-location") || "";
                applyFilters();
            });
        });
    }

    // 7) Navbar shadow on scroll + back-to-top button ---------------------------
    var navbar = document.getElementById("mainNavbar");
    var backToTop = document.getElementById("backToTop");
    function onScroll() {
        var y = window.scrollY || document.documentElement.scrollTop;
        if (navbar) navbar.classList.toggle("scrolled", y > 8);
        if (backToTop) backToTop.classList.toggle("show", y > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (backToTop) {
        backToTop.addEventListener("click", function () {
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    // 8) Members page: sort the cards -------------------------------------------
    // The server renders members A-Z; the dropdown can re-order the SAME
    // cards in the browser (data-name / data-joined attributes on each
    // card), so sorting never needs a page reload and keeps working
    // together with the live search filter above.
    var memberSort = document.getElementById("memberSort");
    if (memberSort) {
        memberSort.addEventListener("change", function () {
            var grid = document.getElementById("cardGrid");
            if (!grid) return;
            var cards = Array.prototype.slice.call(
                grid.querySelectorAll(".filter-item")
            );
            cards.sort(function (a, b) {
                if (memberSort.value === "newest") {
                    // created_at strings sort correctly as text (ISO-like)
                    var ja = a.getAttribute("data-joined") || "";
                    var jb = b.getAttribute("data-joined") || "";
                    return jb.localeCompare(ja);
                }
                var na = a.getAttribute("data-name") || "";
                var nb = b.getAttribute("data-name") || "";
                return na.localeCompare(nb);
            });
            cards.forEach(function (card) { grid.appendChild(card); });
        });
    }

    // 9) Mobile bottom navigation: highlight the current section ---------------
    // The server tells us the current section through <body data-section>
    // (the same navSection the top navbar uses). Profile pages count as
    // the "members" section in that system, so for the bottom bar we look
    // at the address as well: /profile... highlights Profile instead.
    var mobileLinks = document.querySelectorAll(".mobile-nav-link");
    if (mobileLinks.length) {
        var section = document.body.getAttribute("data-section") || "";
        var activeKey = section;
        if (window.location.pathname.indexOf("/profile") === 0) {
            activeKey = "profile";
        } else if (section === "members") {
            activeKey = "members";
        }
        mobileLinks.forEach(function (link) {
            link.classList.toggle(
                "active",
                link.getAttribute("data-nav") === activeKey
            );
        });
    }

    // 10) PWA: service worker + "Install the app" banner ------------------------
    // The service worker (public/sw.js) caches static files so the app
    // loads fast and can be installed on the home screen.
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(function () {
            /* offline support is a bonus - never break the page for it */
        });
    }

    // Install banner rules (see views/partials/footer.ejs for the markup):
    //  - phones only (CSS also hides it on wider screens)
    //  - not when the app is already running installed (standalone)
    //  - not again for 7 days after the user dismisses it
    //  - never again after a successful install
    var banner = document.getElementById("installBanner");
    if (banner) {
        var DISMISS_KEY = "ah_install_dismissed"; // timestamp of dismissal
        var INSTALL_KEY = "ah_installed";         // "1" once installed
        var SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        var store = window.localStorage;
        var isPhone = window.matchMedia("(max-width: 767.98px)").matches;
        var isStandalone =
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true; // iOS way of checking
        var dismissedAt = 0;
        try {
            dismissedAt = parseInt(store.getItem(DISMISS_KEY) || "0", 10) || 0;
        } catch (err) { /* private mode etc. - treat as not dismissed */ }
        var recentlyDismissed =
            dismissedAt && Date.now() - dismissedAt < SEVEN_DAYS;
        var alreadyInstalled = false;
        try { alreadyInstalled = !!store.getItem(INSTALL_KEY); } catch (err) {}

        // Chrome/Edge fire this event when the site CAN be installed.
        // We stop the browser's own mini-prompt and keep the event, so
        // OUR Install button can trigger the real prompt later.
        var deferredPrompt = null;
        window.addEventListener("beforeinstallprompt", function (event) {
            event.preventDefault();
            deferredPrompt = event;
            showBannerSoon();
        });
        window.addEventListener("appinstalled", function () {
            try { store.setItem(INSTALL_KEY, "1"); } catch (err) {}
            hideBanner();
        });

        function showBannerSoon() {
            if (!isPhone || isStandalone || recentlyDismissed ||
                alreadyInstalled || !banner.hidden) {
                return;
            }
            setTimeout(function () {
                banner.hidden = false;
                // next frame, so the slide-up transition can run
                requestAnimationFrame(function () {
                    banner.classList.add("show");
                });
            }, 1200);
        }
        function hideBanner() {
            banner.classList.remove("show");
            setTimeout(function () { banner.hidden = true; }, 450);
        }

        // iOS Safari never fires beforeinstallprompt, so try showing the
        // banner anyway - the Install button then opens the instructions.
        showBannerSoon();

        var installBtn = document.getElementById("installBtn");
        var installSteps = document.getElementById("installSteps");
        if (installBtn) {
            installBtn.addEventListener("click", function () {
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    deferredPrompt.userChoice.then(function (choice) {
                        if (choice.outcome === "accepted") {
                            try { store.setItem(INSTALL_KEY, "1"); } catch (err) {}
                        } else {
                            try {
                                store.setItem(DISMISS_KEY, String(Date.now()));
                            } catch (err) {}
                        }
                        deferredPrompt = null;
                        hideBanner();
                    });
                } else if (installSteps) {
                    // No native prompt available (iOS): explain the steps
                    installSteps.hidden = !installSteps.hidden;
                }
            });
        }
        var installClose = document.getElementById("installClose");
        if (installClose) {
            installClose.addEventListener("click", function () {
                try {
                    store.setItem(DISMISS_KEY, String(Date.now()));
                } catch (err) {}
                hideBanner();
            });
        }
    }
});
