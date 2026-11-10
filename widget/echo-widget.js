/*!
 * Ask Echo widget — drop-in AI assistant by Echo Corp
 * Usage:
 *   <script src="https://YOUR-SERVER/widget/echo-widget.js"
 *           data-client-id="demo"
 *           data-api="https://YOUR-SERVER" defer></script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var CLIENT_ID = script && script.getAttribute("data-client-id");
  var API = (script && script.getAttribute("data-api")) || "";
  if (!CLIENT_ID) {
    console.warn("[Ask Echo] data-client-id is missing");
    return;
  }

  var history = [];
  var busy = false;
  var cfg = { name: "Echo", greeting: "Hi! How can I help?", accentColor: "#6d4aff", suggestions: [] };

  // ---------- styles (scoped with an "echo-" prefix) ----------
  var css = `
  .echo-launcher{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;
    border:0;cursor:pointer;background:var(--echo-accent);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);
    display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s}
  .echo-launcher:hover{transform:scale(1.06)}
  .echo-panel{position:fixed;right:20px;bottom:90px;width:360px;max-width:calc(100vw - 32px);
    height:520px;max-height:calc(100vh - 120px);background:#fff;color:#111;border-radius:16px;
    box-shadow:0 16px 48px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;
    font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;z-index:2147483000}
  .echo-panel.echo-open{display:flex}
  .echo-head{background:var(--echo-accent);color:#fff;padding:14px 16px;font-weight:600;display:flex;
    justify-content:space-between;align-items:center}
  .echo-head button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}
  .echo-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f6f9}
  .echo-msg{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
  .echo-bot{background:#fff;border:1px solid #e6e6ee;align-self:flex-start;border-bottom-left-radius:4px}
  .echo-user{background:var(--echo-accent);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
  .echo-typing{opacity:.6;font-style:italic}
  .echo-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;background:#f6f6f9}
  .echo-chip{border:1px solid var(--echo-accent);color:var(--echo-accent);background:#fff;border-radius:999px;
    padding:5px 10px;font-size:12.5px;cursor:pointer}
  .echo-form{display:flex;border-top:1px solid #e6e6ee}
  .echo-form input{flex:1;border:0;padding:13px 14px;font:inherit;outline:none;color:#111;background:#fff}
  .echo-form button{border:0;background:none;color:var(--echo-accent);font-weight:600;padding:0 16px;cursor:pointer}
  .echo-foot{font-size:11px;text-align:center;color:#888;padding:5px 0 7px;background:#fff}
  `;
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM ----------
  var root = document.createElement("div");
  root.innerHTML =
    '<button class="echo-launcher" aria-label="Open chat">' +
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    "</button>" +
    '<div class="echo-panel" role="dialog" aria-label="Chat assistant">' +
    '<div class="echo-head"><span class="echo-title">Echo</span><button aria-label="Close">×</button></div>' +
    '<div class="echo-log" aria-live="polite"></div>' +
    '<div class="echo-chips"></div>' +
    '<form class="echo-form"><input type="text" placeholder="Type a message…" maxlength="2000" aria-label="Message"><button type="submit">Send</button></form>' +
    '<div class="echo-foot">Powered by Echo · Echo Corp</div>' +
    "</div>";
  document.body.appendChild(root);

  var launcher = root.querySelector(".echo-launcher");
  var panel = root.querySelector(".echo-panel");
  var log = root.querySelector(".echo-log");
  var chips = root.querySelector(".echo-chips");
  var form = root.querySelector(".echo-form");
  var input = form.querySelector("input");

  function setAccent(c) {
    root.style.setProperty("--echo-accent", c);
  }
  setAccent(cfg.accentColor);

  function add(text, who) {
    var el = document.createElement("div");
    el.className = "echo-msg " + (who === "user" ? "echo-user" : "echo-bot");
    el.textContent = text; // textContent, never innerHTML: no XSS from model output
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function renderChips() {
    chips.innerHTML = "";
    (cfg.suggestions || []).slice(0, 4).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "echo-chip";
      b.textContent = s;
      b.onclick = function () {
        send(s);
      };
      chips.appendChild(b);
    });
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    chips.innerHTML = "";
    add(text, "user");
    history.push({ role: "user", content: text });
    var typing = add("Echo is typing…", "bot");
    typing.classList.add("echo-typing");

    fetch(API + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT_ID, messages: history }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        typing.remove();
        var reply = res.ok ? res.d.reply : res.d.error || "Something went wrong.";
        add(reply, "bot");
        if (res.ok) history.push({ role: "assistant", content: reply });
        else history.pop(); // let the user retry the same message
      })
      .catch(function () {
        typing.remove();
        history.pop();
        add("I couldn't connect. Please try again.", "bot");
      })
      .finally(function () {
        busy = false;
        input.focus();
      });
  }

  launcher.onclick = function () {
    panel.classList.toggle("echo-open");
    if (panel.classList.contains("echo-open")) input.focus();
  };
  root.querySelector(".echo-head button").onclick = function () {
    panel.classList.remove("echo-open");
  };
  form.onsubmit = function (e) {
    e.preventDefault();
    send(input.value);
    input.value = "";
  };

  // Load the client's public config (name, greeting, colour, suggestions)
  fetch(API + "/api/config/" + encodeURIComponent(CLIENT_ID))
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (c) {
      if (c) cfg = Object.assign(cfg, c);
    })
    .catch(function () {})
    .finally(function () {
      setAccent(cfg.accentColor);
      root.querySelector(".echo-title").textContent = cfg.name + " · Ask Echo";
      add(cfg.greeting, "bot");
      renderChips();
    });
})();
