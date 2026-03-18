// BuildMatrix - My Builds page logic
// - If logged in: builds are stored in SQLite (backend)
// - If guest/offline: builds are stored in localStorage (fallback)

function getLocalBuildStorageKey() {
  const user = getCurrentUser();
  return user?.id ? `buildmatrix-builds-${user.id}` : "buildmatrix-builds-guest";
}

function getLocalBuilds() {
  return safeJsonParse(localStorage.getItem(getLocalBuildStorageKey()), []) || [];
}

function setLocalBuilds(builds) {
  localStorage.setItem(getLocalBuildStorageKey(), JSON.stringify(builds));
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return "₱" + num.toLocaleString();
}

function summarizeParts(items) {
  const cats = new Map();
  (items || []).forEach((it) => {
    const c = it.category || "other";
    cats.set(c, (cats.get(c) || 0) + 1);
  });

  const sorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 6).map(([cat, count]) => `${cat.toUpperCase()} ×${count}`);
}

function buildCard(build) {
  const card = document.createElement("div");
  card.className = "build-card";

  const header = document.createElement("div");
  header.className = "build-card-header";

  const title = document.createElement("div");
  title.className = "build-name";
  title.textContent = build.name || "Untitled Build";

  const date = document.createElement("div");
  date.className = "build-date";
  date.textContent = formatDate(build.createdAt);

  header.appendChild(title);
  header.appendChild(date);

  const meta = document.createElement("div");
  meta.className = "build-meta";

  const partsCount = document.createElement("span");
  partsCount.innerHTML = `<i class="fas fa-tags"></i> ${Array.isArray(build.items) ? build.items.length : 0} parts`;

  const total = document.createElement("span");
  total.innerHTML = `<i class="fas fa-coins"></i> ${formatMoney(build.total)}`;

  meta.appendChild(partsCount);
  meta.appendChild(total);

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "part-chips";
  const chips = summarizeParts(build.items);
  if (chips.length) {
    chips.forEach((t) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = t;
      chipsWrap.appendChild(chip);
    });
  } else {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = "No items";
    chipsWrap.appendChild(chip);
  }

  const actions = document.createElement("div");
  actions.className = "build-actions";

  const load = document.createElement("a");
  load.className = "btn btn--primary";
  load.href = `index.html?buildId=${encodeURIComponent(build.id)}`;
  load.innerHTML = `<i class="fas fa-play"></i> Load`;

  const rename = document.createElement("button");
  rename.className = "btn btn--ghost";
  rename.type = "button";
  rename.innerHTML = `<i class="fas fa-pen"></i> Rename`;
  rename.addEventListener("click", () => renameBuild(build.id));

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn";
  exportBtn.type = "button";
  exportBtn.innerHTML = `<i class="fas fa-file-export"></i> Export`;
  exportBtn.addEventListener("click", () => exportBuild(build.id));

  const del = document.createElement("button");
  del.className = "btn btn--danger";
  del.type = "button";
  del.innerHTML = `<i class="fas fa-trash"></i> Delete`;
  del.addEventListener("click", () => deleteBuild(build.id));

  actions.appendChild(load);
  actions.appendChild(rename);
  actions.appendChild(exportBtn);
  actions.appendChild(del);

  card.appendChild(header);
  card.appendChild(meta);
  card.appendChild(chipsWrap);
  card.appendChild(actions);

  return card;
}

let allBuilds = [];
let filteredBuilds = [];

function renderBuilds() {
  const grid = document.getElementById("buildsGrid");
  const empty = document.getElementById("emptyState");
  if (!grid || !empty) return;

  grid.innerHTML = "";

  if (filteredBuilds.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  filteredBuilds.forEach((b) => grid.appendChild(buildCard(b)));
}

function applySearch() {
  const q = document.getElementById("searchInput")?.value?.trim().toLowerCase() ?? "";

  if (!q) {
    filteredBuilds = [...allBuilds];
  } else {
    filteredBuilds = allBuilds.filter((b) => (b.name || "").toLowerCase().includes(q));
  }
  renderBuilds();
}

async function loadBuilds() {
  const user = getCurrentUser();

  // Logged-in -> backend builds
  if (user) {
    try {
      const data = await apiFetch("/builds", { method: "GET" });
      return data.builds || [];
    } catch (err) {
      console.warn("Failed to fetch builds from backend, using local fallback:", err);
      showToast("Backend unreachable — showing local builds only.", true);
      return getLocalBuilds();
    }
  }

  // Guest -> local
  return getLocalBuilds();
}

async function refresh() {
  allBuilds = await loadBuilds();
  filteredBuilds = [...allBuilds];
  applySearch();
}

async function renameBuild(buildId) {
  const current = allBuilds.find((b) => b.id === buildId);
  if (!current) return;

  const next = prompt("Rename build:", current.name || "Untitled Build");
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    showToast("Name can't be empty.", true);
    return;
  }

  const user = getCurrentUser();
  if (user) {
    try {
      await apiFetch(`/builds/${encodeURIComponent(buildId)}`, {
        method: "PUT",
        body: JSON.stringify({ name: trimmed }),
      });
      showToast("Build renamed!");
      await refresh();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Rename failed (backend).", true);
      return;
    }
  }

  // local fallback
  const builds = getLocalBuilds();
  const idx = builds.findIndex((b) => b.id === buildId);
  if (idx === -1) return;
  builds[idx].name = trimmed;
  setLocalBuilds(builds);
  showToast("Build renamed!");
  await refresh();
}

async function deleteBuild(buildId) {
  const current = allBuilds.find((b) => b.id === buildId);
  if (!current) return;

  const name = current.name || "this build";
  if (!confirm(`Delete "${name}"?`)) return;

  const user = getCurrentUser();
  if (user) {
    try {
      await apiFetch(`/builds/${encodeURIComponent(buildId)}`, { method: "DELETE" });
      showToast("Build deleted.");
      await refresh();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Delete failed (backend).", true);
      return;
    }
  }

  const builds = getLocalBuilds().filter((b) => b.id !== buildId);
  setLocalBuilds(builds);
  showToast("Build deleted.");
  await refresh();
}

function exportBuild(buildId) {
  const build = allBuilds.find((b) => b.id === buildId);
  if (!build) return;

  const blob = new Blob([JSON.stringify(build, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `buildmatrix-${(build.name || "build").replace(/[^a-z0-9-_]+/gi, "_")}.json`;
  a.click();

  URL.revokeObjectURL(url);
  showToast("Exported build JSON.");
}

async function importBuildFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const obj = JSON.parse(String(reader.result || "{}"));
      if (!obj || typeof obj !== "object") throw new Error("Invalid JSON");
      if (!Array.isArray(obj.items)) throw new Error("Missing items array");

      const normalized = {
        id: obj.id || ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())),
        name: obj.name || "Imported Build",
        createdAt: obj.createdAt || new Date().toISOString(),
        total: obj.total || obj.items.reduce((s, it) => s + (Number(it.price) || 0), 0),
        items: obj.items.map((it) => ({
          name: it.name || "Component",
          price: Number(it.price) || 0,
          category: it.category || "other",
          dataset: it.dataset || {},
        })),
      };

      const user = getCurrentUser();
      if (user) {
        // Import into backend
        await apiFetch("/builds", {
          method: "POST",
          body: JSON.stringify({ name: normalized.name, total: normalized.total, items: normalized.items }),
        });
        showToast("Build imported to your account!");
        await refresh();
        return;
      }

      // Import into localStorage
      const builds = getLocalBuilds();
      builds.unshift(normalized);
      setLocalBuilds(builds);
      showToast("Build imported locally!");
      await refresh();
    } catch (err) {
      console.error(err);
      showToast("Import failed: invalid JSON file", true);
    }
  };
  reader.readAsText(file);
}

async function clearAllBuilds() {
  if (!allBuilds.length) return;
  if (!confirm("Delete ALL builds?")) return;

  const user = getCurrentUser();
  if (user) {
    // No bulk endpoint: delete one-by-one
    try {
      for (const b of allBuilds) {
        await apiFetch(`/builds/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      }
      showToast("All builds deleted.");
      await refresh();
      return;
    } catch (err) {
      console.warn(err);
      showToast("Clear-all failed (backend).", true);
      return;
    }
  }

  setLocalBuilds([]);
  showToast("All local builds cleared.");
  await refresh();
}

function initBuildsPage() {
  initDarkModeToggle();

  // Refresh session -> localStorage
  syncUserFromSession().finally(() => updateAuthUI());

  initUserMenuAutoClose();

  document.getElementById("searchInput")?.addEventListener("input", applySearch);
  document.getElementById("importBtn")?.addEventListener("click", () => {
    document.getElementById("importFile")?.click();
  });
  document.getElementById("importFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importBuildFromFile(file);
    e.target.value = "";
  });
  document.getElementById("clearAllBuildsBtn")?.addEventListener("click", clearAllBuilds);

  refresh();
}

document.addEventListener("DOMContentLoaded", initBuildsPage);
