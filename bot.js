(function () {
  "use strict";

  var API_BASE = "https://avenue-guard.onrender.com";
  var REFRESH_INTERVAL_MS = 30000;
  var REQUEST_TIMEOUT_MS = 12000;

  var elements = {
    avatar: document.getElementById("botAvatar"),
    refresh: document.getElementById("refreshStatus"),
    statusDot: document.getElementById("statusDot"),
    statusLabel: document.getElementById("statusLabel"),
    statusNotice: document.getElementById("statusNotice"),
    version: document.getElementById("versionBadge"),
    uptime: document.getElementById("uptimeValue"),
    uptimeDetail: document.getElementById("uptimeDetail"),
    latency: document.getElementById("latencyValue"),
    members: document.getElementById("memberValue"),
    checked: document.getElementById("checkedValue"),
    releaseCount: document.getElementById("releaseCount"),
    releaseList: document.getElementById("releaseList")
  };

  var lastStatus = null;
  var refreshTimer = null;

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "--";
    var number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "--";
  }

  function formatDuration(totalSeconds) {
    var seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return days + "d " + hours + "h";
    if (hours > 0) return hours + "h " + minutes + "m";
    if (minutes > 0) return minutes + "m";
    return seconds + "s";
  }

  function formatDate(timestamp, includeTime) {
    var seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) return "Unknown";
    var options = includeTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" };
    return new Intl.DateTimeFormat("en-US", options).format(new Date(seconds * 1000));
  }

  function setStatusAppearance(state, online) {
    elements.statusDot.className = "status-dot";
    if (online) {
      elements.statusDot.classList.add("status-dot--online");
      return;
    }
    if (
      state === "starting"
      || state === "database_check"
      || state === "discord_login"
      || state === "reconnecting"
      || state === "waiting_rate_limit"
    ) {
      elements.statusDot.classList.add("status-dot--warning");
      return;
    }
    elements.statusDot.classList.add("status-dot--offline");
  }

  function renderStatus(data) {
    lastStatus = data;
    var online = data.online === true;
    var state = String(data.state || "unknown");
    setStatusAppearance(state, online);

    elements.statusLabel.textContent = String(data.status || (online ? "Operational" : "Unavailable"));
    elements.version.textContent = String(data.version || "Version unavailable");
    elements.uptime.textContent = formatDuration(
      online ? data.online_uptime_seconds : data.process_uptime_seconds
    );
    elements.uptimeDetail.textContent = online
      ? "Connected to Discord since " + formatDate(data.online_since_ts, true)
      : "Render process uptime";
    elements.latency.textContent = data.latency_ms !== null
      && data.latency_ms !== undefined
      && Number.isFinite(Number(data.latency_ms))
      ? Math.round(Number(data.latency_ms)) + " ms"
      : "--";
    elements.members.textContent = formatNumber(data.member_count);
    elements.checked.textContent = formatDate(data.updated_ts, true);
    elements.statusNotice.textContent = "";

    var avatarUrl = String(data.avatar_url || "");
    if (/^https:\/\//i.test(avatarUrl)) {
      elements.avatar.src = avatarUrl;
    }
  }

  function renderUnavailable(message) {
    setStatusAppearance("offline", false);
    elements.statusLabel.textContent = lastStatus
      ? "Status temporarily unavailable"
      : "Unable to reach Avenue Guard";
    elements.statusNotice.textContent = message;
    elements.checked.textContent = formatDate(Date.now() / 1000, true);
  }

  function appendTextElement(parent, tag, className, text) {
    var element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function renderReleases(payload) {
    var releases = Array.isArray(payload.releases) ? payload.releases : [];
    elements.releaseList.replaceChildren();
    elements.releaseCount.textContent = releases.length === 1
      ? "1 release"
      : releases.length + " releases";

    if (!releases.length) {
      var empty = document.createElement("article");
      empty.className = "release-card surface release-card--empty";
      appendTextElement(empty, "h3", "release-card__title", "No approved releases yet");
      appendTextElement(
        empty,
        "p",
        "release-card__summary",
        "The first version will appear here after its owner approval."
      );
      elements.releaseList.appendChild(empty);
      return;
    }

    releases.forEach(function (release, index) {
      var card = document.createElement("article");
      card.className = "release-card surface";
      if (index === 0) card.classList.add("release-card--latest");

      var header = document.createElement("div");
      header.className = "release-card__header";
      var titleWrap = document.createElement("div");
      appendTextElement(titleWrap, "p", "release-card__version", "v" + String(release.version || "Unknown"));
      appendTextElement(titleWrap, "h3", "release-card__title", String(release.title || "Avenue Guard update"));
      header.appendChild(titleWrap);
      appendTextElement(header, "time", "release-card__date", formatDate(release.published_ts, false));
      card.appendChild(header);

      if (String(release.summary || "").trim()) {
        appendTextElement(card, "p", "release-card__summary", String(release.summary));
      }

      var changes = Array.isArray(release.changes) ? release.changes : [];
      if (changes.length) {
        var list = document.createElement("ul");
        list.className = "release-card__changes";
        changes.forEach(function (change) {
          appendTextElement(list, "li", "", String(change));
        });
        card.appendChild(list);
      }

      elements.releaseList.appendChild(card);
    });
  }

  function renderReleaseError() {
    elements.releaseCount.textContent = "Unavailable";
    elements.releaseList.replaceChildren();
    var card = document.createElement("article");
    card.className = "release-card surface release-card--empty";
    appendTextElement(card, "h3", "release-card__title", "Release history could not be loaded");
    appendTextElement(
      card,
      "p",
      "release-card__summary",
      "The live service may be restarting. This page will retry automatically."
    );
    elements.releaseList.appendChild(card);
  }

  function fetchJson(path) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    return fetch(API_BASE + path, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).finally(function () {
      window.clearTimeout(timeout);
    });
  }

  function refresh() {
    elements.refresh.disabled = true;
    elements.refresh.textContent = "Refreshing";

    return Promise.allSettled([
      fetchJson("/api/bot"),
      fetchJson("/api/releases")
    ]).then(function (results) {
      if (results[0].status === "fulfilled") {
        renderStatus(results[0].value);
      } else {
        renderUnavailable("Live data could not be refreshed. Retrying automatically.");
      }

      if (results[1].status === "fulfilled") {
        renderReleases(results[1].value);
      } else {
        renderReleaseError();
      }
    }).finally(function () {
      elements.refresh.disabled = false;
      elements.refresh.textContent = "Refresh";
    });
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(function () {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_INTERVAL_MS);
  }

  elements.refresh.addEventListener("click", refresh);
  elements.avatar.addEventListener("error", function () {
    if (!elements.avatar.src.endsWith("/favicon.ico")) {
      elements.avatar.src = "favicon.ico";
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refresh();
  });

  refresh();
  scheduleRefresh();
}());
