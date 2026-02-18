/* QuizRush — shared client utilities */
(function () {
  "use strict";

  var QuizRush = (window.QuizRush = window.QuizRush || {});

  /* ─── WebSocket ──────────────────────────────────────────────── */
  QuizRush.connect = function (clientId) {
    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    var url =
      protocol +
      "//" +
      window.location.host +
      "/ws?client_id=" +
      encodeURIComponent(clientId);
    var ws = new WebSocket(url);

    ws.onclose = function () {
      QuizRush.toast("Disconnected from server", "error");
    };

    ws.onerror = function () {
      QuizRush.toast("Connection error", "error");
    };

    return ws;
  };

  /* ─── Toast Notifications ────────────────────────────────────── */
  QuizRush.toast = function (message, variant) {
    var container = document.getElementById("toast-container");
    if (!container) return;

    var el = document.createElement("div");
    el.className = "toast " + (variant || "info");
    el.textContent = message;
    container.appendChild(el);

    setTimeout(function () {
      el.classList.add("removing");
      setTimeout(function () {
        el.remove();
      }, 300);
    }, 4000);
  };

  /* ─── HTML Escape ────────────────────────────────────────────── */
  var escapeMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  QuizRush.escapeHtml = function (str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, function (c) {
      return escapeMap[c];
    });
  };

  /* ─── Client ID ──────────────────────────────────────────────── */
  QuizRush.getClientId = function () {
    var id = localStorage.getItem("quizrush_client_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("quizrush_client_id", id);
    }
    return id;
  };
})();
