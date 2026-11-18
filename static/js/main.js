/* ==========================================================================
   Alumni Hub (Minor Project) - main.js
   Three small jobs:
     1. Show flash messages as Bootstrap toasts (auto-hide after 4 seconds)
     2. Ask "Are you sure?" before delete / block actions
     3. Scroll the chat box to the latest message
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
});
