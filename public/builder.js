// BuildMatrix Builder page logic
// Requires: products.js, common.js, html2canvas, jspdf

let currentTotal = 0;
let selectedItems = [];
let currentUserId = null;

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getBuildStorageKey() {
  const user = getCurrentUser();
  return user?.id ? `buildmatrix-builds-${user.id}` : "buildmatrix-builds-guest";
}

function getSavedBuilds() {
  return safeJsonParse(localStorage.getItem(getBuildStorageKey()), []) || [];
}

function setSavedBuilds(builds) {
  localStorage.setItem(getBuildStorageKey(), JSON.stringify(builds));
}

function openAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.style.display = "flex";

  const twofaInput = document.getElementById("twofaInput");
  const login2faCode = document.getElementById("login2faCode");
  if (twofaInput) twofaInput.classList.remove("show");
  if (login2faCode) login2faCode.value = "";
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.style.display = "none";
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginTabBtn = document.getElementById("loginTabBtn");
  const registerTabBtn = document.getElementById("registerTabBtn");

  if (loginForm) loginForm.className = tab === "login" ? "auth-form active" : "auth-form";
  if (registerForm) registerForm.className = tab === "register" ? "auth-form active" : "auth-form";
  if (loginTabBtn) loginTabBtn.className = tab === "login" ? "auth-tab active" : "auth-tab";
  if (registerTabBtn) registerTabBtn.className = tab === "register" ? "auth-tab active" : "auth-tab";

  const twofaInput = document.getElementById("twofaInput");
  if (twofaInput) twofaInput.classList.remove("show");
}

async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value ?? "";
  const twoFactorCode = document.getElementById("login2faCode")?.value?.trim() ?? "";

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, twoFactorCode }),
      credentials: "include",
    });

    const data = await response.json();

    if (data.requires2FA) {
      document.getElementById("twofaInput")?.classList.add("show");
      document.getElementById("login2faCode")?.focus();
      showToast("Please enter your 2FA code");
      return;
    }

    if (data.success) {
      currentUserId = data.user?.id ?? null;
      localStorage.setItem("user", JSON.stringify(data.user));
      updateAuthUI();
      closeAuthModal();
      showToast("Login successful!");

      // clear inputs
      const fields = ["loginEmail", "loginPassword", "login2faCode"];
      fields.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      document.getElementById("twofaInput")?.classList.remove("show");
    } else {
      showToast(data.error || "Login failed", true);
    }
  } catch (error) {
    console.error("Login error:", error);
    showToast("Connection error - Make sure backend is running on port 5000", true);
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const name = document.getElementById("registerName")?.value?.trim();
  const email = document.getElementById("registerEmail")?.value?.trim();
  const password = document.getElementById("registerPassword")?.value ?? "";
  const confirm = document.getElementById("registerConfirm")?.value ?? "";

  if (password !== confirm) {
    showToast("Passwords do not match", true);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await response.json();

    if (data.success) {
      showToast("Registration successful! Please login.");
      switchAuthTab("login");

      ["registerName", "registerEmail", "registerPassword", "registerConfirm"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
    } else {
      showToast(data.error || "Registration failed", true);
    }
  } catch (error) {
    console.error("Register error:", error);
    showToast("Connection error - Make sure backend is running on port 5000", true);
  }
}

// Forgot password
function openForgotPassword() {
  const modal = document.getElementById("forgotPasswordModal");
  if (!modal) return;

  modal.style.display = "flex";
  document.getElementById("forgotStep1")?.classList.add("active");
  document.getElementById("forgotStep2")?.classList.remove("active");

  ["resetEmail", "resetToken", "newPassword", "confirmPassword"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function closeForgotModal() {
  const modal = document.getElementById("forgotPasswordModal");
  if (!modal) return;
  modal.style.display = "none";

  // Reset steps so it always opens clean next time
  document.getElementById("forgotStep1")?.classList.add("active");
  document.getElementById("forgotStep2")?.classList.remove("active");

  // Optional: clear inputs (safe even if ids change)
  ["forgotEmail","forgotCode","forgotNewPassword","forgotConfirmPassword"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}


async function sendResetLink() {
  const email = document.getElementById("resetEmail")?.value?.trim();
  if (!email) {
    showToast("Please enter your email", true);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    console.log("Server response:", data);

    if (data.success) {
      showToast("Reset link generated! (Dev: check console/token)");
      document.getElementById("forgotStep1")?.classList.remove("active");
      document.getElementById("forgotStep2")?.classList.add("active");

      if (data.devToken) {
        const tokenInput = document.getElementById("resetToken");
        if (tokenInput) tokenInput.value = data.devToken;
        console.log("✅ Your reset token:", data.devToken);
      }
    } else {
      showToast(data.error || "Failed to send reset link", true);
    }
  } catch (error) {
    console.error("❌ Forgot password error:", error);
    showToast("Connection error: " + error.message, true);
  }
}

async function resetPassword() {
  const token = document.getElementById("resetToken")?.value?.trim();
  const newPassword = document.getElementById("newPassword")?.value ?? "";
  const confirm = document.getElementById("confirmPassword")?.value ?? "";

  if (!token || !newPassword) {
    showToast("Please fill all fields", true);
    return;
  }
  if (newPassword !== confirm) {
    showToast("Passwords do not match", true);
    return;
  }
  if (newPassword.length < 6) {
    showToast("Password must be at least 6 characters", true);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });

    const data = await response.json();
    console.log("Reset response:", data);

    if (data.success) {
      showToast("✅ Password reset successfully! Please login.");
      document.getElementById("forgotPasswordModal").style.display = "none";
      openAuthModal();
    } else {
      showToast(data.error || "Failed to reset password", true);
    }
  } catch (error) {
    console.error("❌ Reset password error:", error);
    showToast("Connection error: " + error.message, true);
  }
}

// 2FA
async function open2FASetup() {
  const user = getCurrentUser();
  currentUserId = user?.id ?? null;

  if (!currentUserId) {
    showToast("Please login first", true);
    closeUserMenu();
    return;
  }

  try {
    const response = await fetch(`${API_URL}/2fa/setup`, { method: "POST", credentials: "include" });
    const data = await response.json();

    if (data.success) {
      const qr = document.getElementById("qrCodeContainer");
      const secret = document.getElementById("manualSecret");
      if (qr) qr.innerHTML = `<img src="${data.qrCode}" alt="2FA QR Code">`;
      if (secret) secret.textContent = data.secret;

      const modal = document.getElementById("twofaSetupModal");
      if (modal) modal.style.display = "flex";

      const step1 = document.getElementById("twofaStep1");
      const step2 = document.getElementById("twofaStep2");
      if (step1) step1.style.display = "block";
      if (step2) step2.style.display = "none";
    } else {
      showToast(data.error || "Failed to setup 2FA", true);
    }
  } catch (error) {
    console.error("2FA setup error:", error);
    showToast("Connection error", true);
  }

  closeUserMenu();
}

async function verifyAndEnable2FA() {
  const code = document.getElementById("twofaVerifyCode")?.value?.trim() ?? "";

  if (!code || code.length !== 6) {
    showToast("Please enter a valid 6-digit code", true);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/2fa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: code }),
      credentials: "include",
    });

    const data = await response.json();

    if (data.success) {
      const step1 = document.getElementById("twofaStep1");
      const step2 = document.getElementById("twofaStep2");
      if (step1) step1.style.display = "none";
      if (step2) step2.style.display = "block";

      const list = document.getElementById("recoveryCodesList");
      if (list) {
        list.innerHTML = data.recoveryCodes.map((c) => `<div class="recovery-code">${escapeHtml(c)}</div>`).join("");
      }

      showToast("2FA enabled successfully!");
    } else {
      showToast(data.error || "Invalid verification code", true);
    }
  } catch (error) {
    console.error("2FA verify error:", error);
    showToast("Connection error", true);
  }
}

function closeTwofaModal() {
  const modal = document.getElementById("twofaSetupModal");
  if (modal) modal.style.display = "none";
}

// Products rendering helpers
function renderSection(sectionKey, titleHtml, cardsOrProducts) {
  let cardsHtml = "";

  // Backward compatible: accept either a string of HTML or an array of product objects
  if (Array.isArray(cardsOrProducts)) {
    const renderer = typeof window.renderProductCard === "function"
      ? window.renderProductCard
      : () => "";
    cardsHtml = cardsOrProducts.map(renderer).join("");
  } else {
    cardsHtml = String(cardsOrProducts || "");
  }

  return `
    <section class="product-section" data-section="${escapeHtml(sectionKey)}">
      <h2 class="section-title">${titleHtml}</h2>
      <div class="products-grid">
        ${cardsHtml}
      </div>
    </section>
  `;
}

function bindAddToBuildButtons() {
  document.querySelectorAll(".add-to-build").forEach((button) => {
    button.onclick = (e) => {
      e.preventDefault();
      addToBuild(button);
    };
  });
}

function syncSelectedCardsUI() {
  // mark selected product cards + button labels
  selectedItems.forEach((item) => {
    document.querySelectorAll(".product-card").forEach((card) => {
      if (card.dataset.name === item.name) {
        card.classList.add("selected");
        const btn = card.querySelector(".add-to-build");
        if (btn) btn.textContent = "✓ Added";
      }
    });
  });
}

function showAllProducts() {
  const groups = (typeof window.getProductGroups === "function") ? window.getProductGroups() : [];
  let html = "";
  groups.forEach((g) => {
    html += renderSection(g.section, g.title, g.products);
  });

  const main = document.getElementById("mainContent");
  if (main) main.innerHTML = html || "<p style=\"color: var(--text-secondary)\">No products found.</p>";

  bindAddToBuildButtons();
  syncSelectedCardsUI();
}

function filterCategory(category) {
  const sections = document.querySelectorAll(".product-section");
  if (!sections.length) return;

  sections.forEach((sec) => {
    sec.style.display = sec.dataset.section === category ? "block" : "none";
  });
}

function addToBuild(button) {
  const card = button.closest(".product-card");
  if (!card) return;

  const price = parseInt(card.dataset.price || "0", 10);
  const name = card.dataset.name || "Component";
  const category = card.dataset.category || "other";

  const singleOnly = ["cpu", "gpu", "motherboard", "psu", "case"];

  // If selecting a single-only category and another item exists, replace it automatically.
  if (singleOnly.includes(category) && !card.classList.contains("selected")) {
    const existing = selectedItems.find((item) => item.category === category);
    if (existing && existing.name !== name) {
      // remove existing
      currentTotal -= existing.price;
      selectedItems = selectedItems.filter((item) => item.category !== category);

      // unselect UI for existing card
      document.querySelectorAll(".product-card").forEach((c) => {
        if (c.dataset.name === existing.name) {
          c.classList.remove("selected");
          const b = c.querySelector(".add-to-build");
          if (b) b.textContent = "+ Add to Build";
        }
      });
      showToast(`Replaced ${category.toUpperCase()}: ${existing.name} → ${name}`);
    }
  }

  if (card.classList.contains("selected")) {
    card.classList.remove("selected");
    currentTotal -= price;
    selectedItems = selectedItems.filter((item) => item.name !== name);
    button.textContent = "+ Add to Build";
    showToast(`${name} removed`);
  } else {
    card.classList.add("selected");
    currentTotal += price;

    // Copy dataset to a plain object (so it can be JSON saved later)
    const datasetCopy = { ...card.dataset };
    selectedItems.push({ name, price, category, dataset: datasetCopy });

    button.textContent = "✓ Added";
    showToast(`${name} added`);
  }

  updateBuildDisplay();
  updateFPS();
  checkCompatibility();
}

function removeItem(itemName) {
  const item = selectedItems.find((i) => i.name === itemName);
  if (!item) return;

  currentTotal -= item.price;
  selectedItems = selectedItems.filter((i) => i.name !== itemName);

  document.querySelectorAll(".product-card").forEach((card) => {
    if (card.dataset.name === itemName) {
      card.classList.remove("selected");
      const btn = card.querySelector(".add-to-build");
      if (btn) btn.textContent = "+ Add to Build";
    }
  });

  updateBuildDisplay();
  updateFPS();
  checkCompatibility();
}

function clearAllBuild() {
  if (selectedItems.length === 0) return;

  if (confirm("Clear all parts?")) {
    document.querySelectorAll(".product-card.selected").forEach((card) => {
      card.classList.remove("selected");
      const btn = card.querySelector(".add-to-build");
      if (btn) btn.textContent = "+ Add to Build";
    });

    selectedItems = [];
    currentTotal = 0;
    updateBuildDisplay();
    document.getElementById("fpsPanel").style.display = "none";
    document.getElementById("compatibilityPanel").style.display = "none";
    document.getElementById("clearAllBtn").style.display = "none";
  }
}

function updateBuildDisplay() {
  const total = document.getElementById("totalPrice");
  if (total) total.textContent = "₱" + currentTotal.toLocaleString();

  const selectedParts = document.getElementById("selectedParts");
  const clearBtn = document.getElementById("clearAllBtn");

  if (!selectedParts || !clearBtn) return;

  if (selectedItems.length > 0) {
    let html = '<h3 style="margin-bottom: 15px; color: var(--text);">Selected Components:</h3>';
    selectedItems.forEach((item) => {
      const safeName = escapeHtml(item.name);
      const safeOnclickName = item.name.replace(/'/g, "\\'");
      html += `
        <div class="selected-item">
          <span class="item-name">${safeName}</span>
          <span class="item-price">₱${Number(item.price).toLocaleString()}</span>
          <span class="remove-item" onclick="removeItem('${safeOnclickName}')">
            <i class="fas fa-times"></i>
          </span>
        </div>
      `;
    });
    selectedParts.innerHTML = html;
    clearBtn.style.display = "block";
  } else {
    selectedParts.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <i class="fas fa-arrow-left" style="font-size: 3rem; margin-bottom: 15px;"></i>
        <h3>No items selected</h3>
        <p>Click "Add to Build" on any product</p>
      </div>
    `;
    clearBtn.style.display = "none";
  }
}

function updateFPS() {
  let cpuPerf = 0,
    gpuPerf = 0;

  const cpu = selectedItems.find((item) => item.category === "cpu");
  const gpu = selectedItems.find((item) => item.category === "gpu");

  if (cpu) cpuPerf = parseInt(cpu.dataset?.perf || "0", 10);
  if (gpu) gpuPerf = parseInt(gpu.dataset?.perf || "0", 10);

  const panel = document.getElementById("fpsPanel");
  const content = document.getElementById("fpsContent");
  if (!panel || !content) return;

  if (cpuPerf === 0 || gpuPerf === 0) {
    panel.style.display = "none";
    return;
  }

  const avgPerf = (cpuPerf + gpuPerf) / 2;

  content.innerHTML = `
    <div class="fps-card"><div>🎯 Valorant</div><div class="fps-value">${Math.round(avgPerf * 2.2)} FPS</div></div>
    <div class="fps-card"><div>🚗 GTA V</div><div class="fps-value">${Math.round(avgPerf * 1.5)} FPS</div></div>
    <div class="fps-card"><div>🌃 Cyberpunk</div><div class="fps-value">${Math.round(avgPerf * 0.9)} FPS</div></div>
  `;

  panel.style.display = "block";
}

function checkCompatibility() {
  const warnings = [];

  const cpu = selectedItems.find((item) => item.category === "cpu");
  const gpu = selectedItems.find((item) => item.category === "gpu");
  const motherboard = selectedItems.find((item) => item.category === "motherboard");
  const pcCase = selectedItems.find((item) => item.category === "case");
  const psu = selectedItems.find((item) => item.category === "psu");

  if (cpu && motherboard && cpu.dataset?.socket !== motherboard.dataset?.socket) {
    warnings.push({
      type: "critical",
      msg: `CPU socket (${cpu.dataset?.socket}) does not match motherboard (${motherboard.dataset?.socket})`,
    });
  }

  if (gpu && pcCase) {
    const gpuLength = parseInt(gpu.dataset?.length || "0", 10);
    const caseMaxLength = parseInt(pcCase.dataset?.maxGpuLength || "0", 10);
    if (gpuLength > 0 && caseMaxLength > 0 && gpuLength > caseMaxLength) {
      warnings.push({
        type: "critical",
        msg: `GPU length (${gpuLength}mm) exceeds case max (${caseMaxLength}mm)`,
      });
    }
  }

  if (cpu && gpu && psu) {
    const cpuTdp = parseInt(cpu.dataset?.tdp || "0", 10);
    const gpuTdp = parseInt(gpu.dataset?.tdp || "0", 10);
    const totalTdp = cpuTdp + gpuTdp + 100; // rough overhead
    const psuWattage = parseInt(psu.dataset?.wattage || "0", 10);

    if (totalTdp > psuWattage) {
      warnings.push({
        type: "critical",
        msg: `Power draw ~${totalTdp}W exceeds PSU capacity (${psuWattage}W)`,
      });
    } else if (totalTdp > psuWattage * 0.8) {
      warnings.push({
        type: "warning",
        msg: `Power draw ~${totalTdp}W is close to PSU limit (${psuWattage}W)`,
      });
    }
  }

  const panel = document.getElementById("compatibilityPanel");
  const list = document.getElementById("compatibilityList");
  if (!panel || !list) return;

  if (warnings.length > 0) {
    list.innerHTML = warnings
      .map((w) => {
        const icon = w.type === "critical" ? "fa-times-circle" : "fa-exclamation-triangle";
        return `
          <div class="warning-item ${w.type === "critical" ? "critical-item" : ""}">
            <i class="fas ${icon}"></i>
            <div>${escapeHtml(w.msg)}</div>
          </div>
        `;
      })
      .join("");

    panel.style.display = "block";
    panel.className = `compatibility-panel ${
      warnings.some((w) => w.type === "critical") ? "compatibility-critical" : ""
    }`;
  } else {
    panel.style.display = "none";
  }
}

// Exports
function downloadScreenshot() {
  if (selectedItems.length === 0) {
    showToast("Add items to your build first!", true);
    return;
  }

  showToast("Generating screenshot...");

  const element = document.getElementById("buildSidebar");

  html2canvas(element, {
    scale: 2,
    backgroundColor: document.body.classList.contains("dark-mode") ? "#1e1e1e" : "#ffffff",
    logging: false,
    allowTaint: false,
    useCORS: true,
  })
    .then((canvas) => {
      const link = document.createElement("a");
      link.download = `buildmatrix-build-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast("Screenshot saved!");
    })
    .catch((error) => {
      console.error("Screenshot error:", error);
      showToast("Failed to generate screenshot", true);
    });
}

function downloadPDF() {
  if (selectedItems.length === 0) {
    showToast("Add items to your build first!", true);
    return;
  }

  showToast("Generating PDF...");

  const element = document.getElementById("buildSidebar");

  html2canvas(element, {
    scale: 2,
    backgroundColor: document.body.classList.contains("dark-mode") ? "#1e1e1e" : "#ffffff",
    logging: false,
    allowTaint: false,
    useCORS: true,
  })
    .then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF();
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      pdf.save(`buildmatrix-build-${Date.now()}.pdf`);
      showToast("PDF saved!");
    })
    .catch((error) => {
      console.error("PDF error:", error);
      showToast("Failed to generate PDF", true);
    });
}

// Save builds (localStorage)
async function saveCurrentBuild() {
  if (selectedItems.length === 0) {
    showToast("Add items first before saving!", true);
    return;
  }

  const defaultName = `My Build (${new Date().toLocaleDateString()})`;
  const name = prompt("Name your build:", defaultName);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("Build name can't be empty.", true);
    return;
  }

  const buildPayload = {
    name: trimmed,
    total: currentTotal,
    items: selectedItems.map((item) => ({
      name: item.name,
      price: item.price,
      category: item.category,
      dataset: item.dataset || {},
    })),
  };

  const user = getCurrentUser();

  // If logged in -> save to DB, else -> localStorage
  if (user) {
    try {
      const data = await apiFetch("/builds", {
        method: "POST",
        body: JSON.stringify(buildPayload),
      });

      showToast("Build saved to your account!");
      return;
    } catch (err) {
      console.warn("DB save failed, fallback to localStorage:", err);
      showToast("Backend save failed — saved locally instead.", true);
      // fallthrough to local save
    }
  }

  const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const build = {
    id,
    name: trimmed,
    createdAt: new Date().toISOString(),
    total: currentTotal,
    items: buildPayload.items,
  };

  const builds = getSavedBuilds();
  builds.unshift(build);
  setSavedBuilds(builds);

  showToast("Build saved locally!");
}

function showMyBuilds() {
  window.location.href = "my-builds.html";
}

function showFavorites() {
  showToast("Favorites are not included in this version.");
  closeUserMenu();
}

// Load build from URL (?buildId=...)
async function loadBuildFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const buildId = params.get("buildId");
  if (!buildId) return;

  const user = getCurrentUser();

  // If logged in, try DB first
  if (user) {
    try {
      const data = await apiFetch(`/builds/${encodeURIComponent(buildId)}`, { method: "GET" });
      const build = data?.build;

      if (build) {
        selectedItems = Array.isArray(build.items) ? build.items : [];
        currentTotal = selectedItems.reduce((sum, item) => sum + (parseInt(item.price || "0", 10) || 0), 0);

        updateBuildDisplay();
        updateFPS();
        checkCompatibility();

        showToast(`Loaded: ${build.name}`);
        return;
      }
    } catch (err) {
      console.warn("Failed to load build from DB, fallback to local:", err);
    }
  }

  // Fallback: localStorage
  const builds = getSavedBuilds();
  const build = builds.find((b) => b.id === buildId);

  if (!build) {
    showToast("Build not found.", true);
    return;
  }

  selectedItems = Array.isArray(build.items) ? build.items : [];
  currentTotal = selectedItems.reduce((sum, item) => sum + (parseInt(item.price || "0", 10) || 0), 0);

  updateBuildDisplay();
  updateFPS();
  checkCompatibility();

  showToast(`Loaded: ${build.name}`);
}

// init
async function initBuilderPage() {
  initDarkModeToggle();

  // Sync session -> localStorage (so refresh keeps you logged in)
  await syncUserFromSession();
  updateAuthUI();

  initUserMenuAutoClose();

  showAllProducts();
  updateBuildDisplay();

  // Auto-load build if ?buildId=...
  await loadBuildFromUrl();

  // Close modals
  document.getElementById("closeAuth")?.addEventListener("click", closeAuthModal);
  document.getElementById("closeForgot")?.addEventListener("click", closeForgotModal);
  document.getElementById("closeTwofa")?.addEventListener("click", closeTwofaModal);

  // Close modals on outside click
  window.addEventListener("click", (e) => {
    const authModal = document.getElementById("authModal");
    const forgotModal = document.getElementById("forgotPasswordModal");
    const twofaModal = document.getElementById("twofaSetupModal");

    if (authModal && e.target === authModal) closeAuthModal();
    if (forgotModal && e.target === forgotModal) closeForgotModal();
    if (twofaModal && e.target === twofaModal) closeTwofaModal();
  });
}

document.addEventListener("DOMContentLoaded", initBuilderPage);

// Expose functions used by inline handlers (safe)
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;

window.openForgotPassword = openForgotPassword;
window.sendResetLink = sendResetLink;
window.resetPassword = resetPassword;

window.open2FASetup = open2FASetup;
window.verifyAndEnable2FA = verifyAndEnable2FA;
window.closeTwofaModal = closeTwofaModal;

window.showAllProducts = showAllProducts;
window.filterCategory = filterCategory;
window.addToBuild = addToBuild;
window.removeItem = removeItem;
window.clearAllBuild = clearAllBuild;

window.downloadScreenshot = downloadScreenshot;
window.downloadPDF = downloadPDF;
window.saveCurrentBuild = saveCurrentBuild;

window.showMyBuilds = showMyBuilds;
window.showFavorites = showFavorites;



/* ===== BUILDMATRIX BUILDERSTYLE PATCH =====
   - PC Builder vibe: select a category, browse items with search + brand filter
   - Click a product to preview details on the right (Selection panel)
   - Add to Build remains fully functional (reuses existing addToBuild)
*/
(function () {
  function getAllProductsSafe() {
    try {
      // In this project, builder.js uses a global `products` array created by products-data.js
      if (Array.isArray(window.products)) return window.products;
      if (Array.isArray(window.PRODUCTS)) return window.PRODUCTS;
      if (window.products && typeof window.products === "object") return Object.values(window.products).flat().filter(Boolean);
    } catch (e) {}
    return [];
  }

  function inferBrand(p) {
    if (p.brand) return String(p.brand);
    const n = String(p.name || "");
    return n.split(" ")[0] || "Unknown";
  }

  function parseSpecsList(p) {
    // "complete specs" = show the full specs string + any meta fields if present
    const list = [];
    const specs = String(p.specs || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const s of specs) list.push(s);
    const meta = p.meta && typeof p.meta === "object" ? p.meta : {};
    // add common meta keys if present
    const addMeta = (k, label) => {
      if (meta[k] !== undefined && meta[k] !== null && String(meta[k]).trim() !== "") {
        list.push(`${label}: ${meta[k]}`);
      }
    };
    addMeta("socket", "Socket");
    addMeta("tdp", "TDP");
    addMeta("vram", "VRAM");
    addMeta("chipset", "Chipset");
    addMeta("wattage", "Wattage");
    addMeta("capacity", "Capacity");
    addMeta("speed", "Speed");
    addMeta("size", "Size");
    addMeta("length", "Length");
    addMeta("perf", "Perf Score");
    return list.length ? list : ["Specs not listed"];
  }

  const UI = {
    activeCategory: "cpu",
    search: "",
    brand: "all",
    selectedProductId: null,
  };

  function ensureFilterBar(main) {
    if (main.querySelector(".products-filterbar")) return;

    const bar = document.createElement("div");
    bar.className = "products-filterbar";

    bar.innerHTML = `
      <div class="pill" style="flex:1; min-width:260px;">
        <i class="fas fa-search"></i>
        <input id="bmSearch" type="text" placeholder="Search for products" />
      </div>
      <div class="pill">
        <i class="fas fa-filter"></i>
        <select id="bmBrand">
          <option value="all">All Brands</option>
        </select>
      </div>
      <button class="dark-mode-toggle" id="bmClearFilters" type="button" style="white-space:nowrap;">
        Clear filters
      </button>
    `;

    main.prepend(bar);

    const search = bar.querySelector("#bmSearch");
    const brand = bar.querySelector("#bmBrand");
    const clear = bar.querySelector("#bmClearFilters");

    if (search) {
      search.value = UI.search;
      search.addEventListener("input", () => {
        UI.search = search.value;
        renderCategoryView(UI.activeCategory);
      });
    }
    if (brand) {
      brand.value = UI.brand;
      brand.addEventListener("change", () => {
        UI.brand = brand.value;
        renderCategoryView(UI.activeCategory);
      });
    }
    if (clear) {
      clear.addEventListener("click", () => {
        UI.search = "";
        UI.brand = "all";
        UI.selectedProductId = null;
        renderCategoryView(UI.activeCategory);
      });
    }
  }

  function renderSelectionDetail(product) {
    const panel = document.getElementById("selectionDetail");
    if (!panel) return;

    if (!product) {
      panel.innerHTML = `
        <h3>SELECT A PART</h3>
        <p class="sd-note">Click a product card to preview its specifications here.</p>
      `;
      return;
    }

    const img = product.img || product.image || "assets/placeholder.svg";
    const catLabel = String(product.category || "part").toUpperCase();
    const specsList = parseSpecsList(product);
    const specsHTML = specsList.map(s => `<li>${escapeHtml(String(s))}</li>`).join("");

    panel.innerHTML = `
      <h3>SELECT ${catLabel}</h3>
      <p class="sd-note">Preview specs. Use <b>Add to Build</b> to add it to your build.</p>

      <div class="sd-img">
        <img src="${img}" alt="" onerror="this.src='assets/placeholder.svg'"/>
      </div>

      <div class="sd-title">${escapeHtml(String(product.name || ""))}</div>
      <div style="font-weight:800; margin: 0 0 8px 0;">₱${Number(product.price||0).toLocaleString()}</div>

      <div id="sdBenchmark" style="opacity:.9; font-weight:900; margin: 0 0 10px 0;">
        ${(["cpu","gpu"].includes(String(product.category||"").toLowerCase())) ? `PassMark: loading…` : ``}
      </div>

      <ul class="sd-specs">${specsHTML}</ul>

      <div class="sd-actions">
        <button class="save-build-btn" type="button" id="sdAddBtn"><i class="fas fa-plus"></i> Add to Build</button>
      </div>
    `;

        // Real benchmark fetch (CPU/GPU)
    (async () => {
      try {
        const cat = String(product.category||"").toLowerCase();
        if(cat !== "cpu" && cat !== "gpu") return;
        const el = panel.querySelector("#sdBenchmark");
        if (!el) return;
        const data = (typeof bmGetRealBenchmark === "function") ? await bmGetRealBenchmark(product) : null;
        if (data && data.score) {
          el.innerHTML = `<span style="opacity:.75; font-weight:800;">${data.source}:</span> ${Number(data.score).toLocaleString()} <a href="${data.url}" target="_blank" style="opacity:.8; margin-left:8px;">source</a>`;
        } else {
          el.textContent = "PassMark: unavailable";
        }
      } catch(e){}
    })();

    const addBtn = panel.querySelector("#sdAddBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        // find matching card currently rendered and click its button
        const card = document.querySelector(`.product-card[data-id="${CSS.escape(String(product.id||""))}"]`)
          || Array.from(document.querySelectorAll(".product-card")).find(c => c.dataset.name === String(product.name||""));
        const b = card ? card.querySelector(".add-to-build") : null;
        if (b) addToBuild(b);
      });
    }
  }

  function buildBrandsForCategory(items) {
    const brands = Array.from(new Set(items.map(inferBrand))).sort((a,b)=>a.localeCompare(b));
    return brands;
  }

  // Override/extend renderSection so cards carry an id for selection detail
  const _origRenderSection = window.renderSection;
  if (typeof _origRenderSection === "function") {
    window.renderSection = function (sectionId, titleHtml, list) {
      // call original to keep layout, then inject data-id into cards using a cheap regex transform
      const html = _origRenderSection(sectionId, titleHtml, list);
      // We can't reliably patch inside original output without DOM, so we keep as-is for non-category view.
      return html;
    };
  }

  function categoryTitle(cat) {
    const map = {
      cpu: "PROCESSORS",
      gpu: "GRAPHICS CARDS",
      motherboard: "MOTHERBOARDS",
      ram: "MEMORY (RAM)",
      ssd: "SSDs",
      hdd: "HDDs",
      psu: "POWER SUPPLIES",
      case: "PC CASES",
      monitor: "MONITORS",
      keyboard: "KEYBOARDS",
      mouse: "MICE",
    };
    return map[cat] || cat.toUpperCase();
  }

  function renderCategoryView(category) {
    UI.activeCategory = category;

    const main = document.getElementById("mainContent");
    if (!main) return;
    const already = (main.dataset && main.dataset.bmCategory === String(category) && main.querySelector("#bmGrid") && main.querySelector(".products-filterbar"));
    if (!already) {
      // shell
      main.innerHTML = `
      <div>
        <h2 style="margin: 0 0 10px;">${categoryTitle(category)}</h2>
        <div id="bmGrid" class="products-grid"></div>
      </div>
    `;
    }

    if (main.dataset) main.dataset.bmCategory = String(category);

    ensureFilterBar(main);


    const all = getAllProductsSafe().filter(p => String(p.category).toLowerCase() !== "laptop");
    const items = all.filter(p => String(p.category) === String(category));

    // populate brand dropdown based on this category
    const brandSelect = document.getElementById("bmBrand");
    if (brandSelect) {
      const brands = buildBrandsForCategory(items);
      const current = UI.brand;
      brandSelect.innerHTML = `<option value="all">All Brands</option>` + brands.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
      if ([...brandSelect.options].some(o => o.value === current)) brandSelect.value = current;
      else { UI.brand = "all"; brandSelect.value = "all"; }
    }

    // apply filters
    const q = String(UI.search || "").toLowerCase().trim();
    let filtered = items.slice();
    if (UI.brand !== "all") filtered = filtered.filter(p => inferBrand(p) === UI.brand);
    if (q) filtered = filtered.filter(p => (String(p.name||"")+" "+String(p.specs||"")).toLowerCase().includes(q));

    // render cards (match your existing card style and add data-id)
    const grid = document.getElementById("bmGrid");
    if (!grid) return;

    const cards = filtered.map(p => {
      const img = p.img || p.image || "assets/placeholder.svg";
      const price = Number(p.price||0);
      const specs = String(p.specs||"");
      const tier = p.tier ? String(p.tier).toUpperCase() : "";

      // dataset for addToBuild (existing function)
      const meta = (p.meta && typeof p.meta === "object") ? p.meta : {};
      const dataAttrs = `data-id="${escapeHtml(String(p.id||""))}"
                         data-name="${escapeHtml(String(p.name||""))}"
                         data-price="${price}"
                         data-category="${escapeHtml(String(p.category||"other"))}"
                         data-specs="${escapeHtml(String(p.specs||""))}"
                         data-perf="${escapeHtml(String(meta.perf||""))}"
                         data-socket="${escapeHtml(String(meta.socket||""))}"
                         data-tdp="${escapeHtml(String(meta.tdp||""))}"
                         data-length="${escapeHtml(String(meta.length||""))}"
                         data-maxGpuLength="${escapeHtml(String(meta.gpuMaxLength||meta.maxGpuLength||""))}"
                         data-wattage="${escapeHtml(String(meta.wattage||meta.watts||""))}"
                         data-formFactor="${escapeHtml(String(meta.formFactor||""))}"
                         data-ddr="${escapeHtml(String(meta.ddr||""))}"`;

      const badgeClass = p.tier === "budget" ? "badge-budget" : (p.tier === "performance" ? "badge-performance" : "badge-premium");

      return `
        <div class="product-card" ${dataAttrs}>
          <div class="product-image">
            <img src="${img}" alt="" onerror="this.src='assets/placeholder.svg'"/>
          </div>
          <div class="product-info">
            <h3>${escapeHtml(String(p.name||""))}</h3>
            <p>${escapeHtml(specs)}</p>
            <div class="product-price">₱${price.toLocaleString()}</div>
            ${tier ? `<span class="badge ${badgeClass}">${escapeHtml(tier)}</span>` : ""}
            <div class="rating">
              <span class="stars">⭐</span>
              <span>${escapeHtml(String(p.rating||""))} (${escapeHtml(String(p.ratingCount||0))})</span>
            </div>
            ${(["cpu","gpu"].includes(String(p.category||"").toLowerCase())) ? `
              <div class="bm-bench" style="margin: 8px 0 10px; opacity:.9; font-weight:900;">
                PassMark: <span class="bm-bench-value" data-bm-bench="pending">…</span>
              </div>
            ` : ``}
            
            ${(["cpu","gpu"].includes(String(p.category||"").toLowerCase())) ? `
              <div style="margin: 8px 0 10px; opacity:.9; font-weight:800;">
                <span style="opacity:.75; font-weight:700;">${getBMLabel(p)}:</span>
                <span> ${getBMScore(p).toLocaleString()}</span>
              </div>
            ` : ``}
            <button class="add-to-build"  type="button" onclick="addToBuild(this)">+ Add to Build</button>
          </div>
        </div>
      `;
    }).join("");

    grid.innerHTML = cards || `<div style="opacity:.75; padding:12px;">No items found.</div>`;

    // clicking a card previews details
    grid.querySelectorAll(".product-card").forEach(card => {
      card.addEventListener("click", (e) => {
        // don't steal click from add button
        if (e.target && e.target.closest && e.target.closest(".add-to-build")) return;

        const id = card.dataset.id || null;
        UI.selectedProductId = id;

        const p = filtered.find(x => String(x.id||"") === String(id))
          || filtered.find(x => String(x.name||"") === String(card.dataset.name||""));

        renderSelectionDetail(p);
      });
    });

    // default selection panel state
    renderSelectionDetail(null);

    // keep selected UI in sync
    syncSelectedCardsUI();

    // make category buttons highlight (optional)
    document.querySelectorAll(".category-item").forEach(btn => btn.classList.remove("active"));
    const activeBtn = Array.from(document.querySelectorAll(".category-item")).find(b => (b.getAttribute("onclick")||"").includes(`'${category}'`) || (b.getAttribute("onclick")||"").includes(`"${category}"`));
    if (activeBtn) activeBtn.classList.add("active");
  }

  // Override filterCategory to use the new view (same function name used in index.html buttons)
  const _origFilterCategory = window.filterCategory;
  window.filterCategory = function (category) {
    // call original to keep any internal state, but render our view
    try { if (typeof _origFilterCategory === "function") _origFilterCategory(category); } catch (e) {}
    renderCategoryView(category);
  };

  // Override showAllProducts to go back to builder's original "all sections" view
  const _origShowAllProducts = window.showAllProducts;
  window.showAllProducts = function () {
    try { if (typeof _origShowAllProducts === "function") _origShowAllProducts(); } catch (e) {}
    // clear selection panel
    renderSelectionDetail(null);
    // highlight builder link
    document.querySelectorAll(".top-nav .nav-link").forEach(a => a.classList.remove("active"));
    const builderLink = document.querySelector(".top-nav .nav-link");
    if (builderLink) builderLink.classList.add("active");
  };

  // When page loads, render default category view (GPU or CPU) AFTER original init
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(() => {
      renderCategoryView("cpu"); // default to GPU like many builders
    }, 80);
  });
})();



/* ===== BUILDMATRIX OVERVIEW VIEW PATCH =====
   Adds an Overview screen (inside the same page) that lists selected parts with:
   - Modify (jump to category)
   - Remove (uses existing removeItem)
   - Total
   This is inspired by common configurators but uses original wording/layout.
*/
(function () {
  const CAT_LABEL = {
    cpu: "CPU",
    gpu: "GPU",
    motherboard: "MB",
    ram: "RAM",
    ssd: "SSD",
    hdd: "HDD",
    psu: "PSU",
    case: "CASE",
    monitor: "MONITOR",
    keyboard: "KEYBOARD",
    mouse: "MOUSE",
  };

  function catLabel(cat){
    const c = String(cat||"").toLowerCase();
    return CAT_LABEL[c] || c.toUpperCase();
  }

  function escape(s){ return (typeof escapeHtml === "function") ? escapeHtml(String(s||"")) : String(s||""); }

  function ensureArray(x){ return Array.isArray(x) ? x : []; }

  
  function bmFindProductByName(name) {
    try {
      const all = (Array.isArray(window.products) ? window.products :
                  Array.isArray(window.PRODUCTS) ? window.PRODUCTS :
                  (window.products && typeof window.products==="object" ? Object.values(window.products).flat().filter(Boolean) : []));
      return all.find(p => String(p.name||"") === String(name||""));
    } catch(e) { return null; }
  }
function renderOverview() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    // Make sure selectedItems/currentTotal exist (they do in this file)
    const items = ensureArray(window.selectedItems || selectedItems);
    const total = Number(window.currentTotal ?? currentTotal ?? 0);

    // group items by category order
    const order = ["gpu","cpu","motherboard","case","ram","ssd","hdd","psu","monitor","keyboard","mouse"];
    const byCat = {};
    items.forEach(it => {
      const c = String(it.category || "other").toLowerCase();
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(it);
    });

    const hardwareList = order
      .filter(c => (byCat[c] && byCat[c].length))
      .map(c => {
        const first = byCat[c][0];
        return `
          <div class="ov-item">
            <div class="ov-item-left">
              <div class="ov-item-cat">${catLabel(c)}</div>
              <div class="ov-item-name">${escape(first.name)}</div>
            </div>
            <div class="ov-item-actions">
              <button class="ov-link" type="button" onclick="filterCategory('${c}')">Change</button>
            </div>
          </div>
        `;
      }).join("");

    const orderList = order
      .filter(c => (byCat[c] && byCat[c].length))
      .map(c => {
        return byCat[c].map(it => {
          const price = Number(it.price||0);
          return `
            <div class="ov-item">
              <div class="ov-item-left">
                <div class="ov-item-cat">${catLabel(c)}</div>
                <div class="ov-item-name">${escape(it.name)}</div>
                ${it.dataset && it.dataset.specs ? `<div style="opacity:.8; font-size:.9rem; margin-top:4px;">${escape(it.dataset.specs)}</div>` : ""}
                ${(() => { const p = bmFindProductByName(it.name); const c = String(it.category||"").toLowerCase(); if((c==="cpu"||c==="gpu") && p && typeof getBMScore==="function") { return `<div style="opacity:.85; font-size:.9rem; margin-top:4px;"><b>${getBMLabel(p)}:</b> ${getBMScore(p).toLocaleString()}</div>`; } return ""; })()}
              </div>
              <div class="ov-item-actions">
                <div style="font-weight:900;">₱${price.toLocaleString()}</div>
                <button class="ov-link" type="button" onclick="bmOverviewRemove('${escape(it.name).replaceAll("'","&#39;")}')">Remove</button>
              </div>
            </div>
          `;
        }).join("");
      }).join("");

    main.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 10px;">
        <div>
          <h2 style="margin:0;">Overview</h2>
          <div style="opacity:.8; margin-top:2px;">Review your selected parts and jump back to any category to adjust.</div>
        </div>
        <button class="dark-mode-toggle" type="button" onclick="showAllProducts()">
          <i class="fas fa-wrench"></i> Back to Builder
        </button>
      </div>

      <div class="overview-grid">
        <section class="ov-card">
          <h3>Your Picks</h3>
          <div class="ov-list">
            ${hardwareList || `<div style="opacity:.75;">No parts selected yet.</div>`}
          </div>
        </section>

        <section class="ov-card">
          <h3>Build Summary</h3>
          <div class="ov-list">
            ${orderList || `<div style="opacity:.75;">Add parts from the Builder to see them here.</div>`}
          </div>
          <div class="ov-total-row">
            <span>Total</span>
            <span>₱${total.toLocaleString()}</span>
          </div>
          <div style="display:flex; gap:10px; margin-top: 12px;">
            <button class="save-build-btn" type="button" onclick="saveCurrentBuild()"><i class="fas fa-save"></i> Save Build</button>
            <button class="pdf-btn" type="button" onclick="downloadPDF()"><i class="fas fa-file-pdf"></i> Save PDF</button>
          </div>
        </section>

        <section class="ov-card">
          <h3>BuildMatrix Promise</h3>
          <ul class="ov-bullets">
            <li>Quick compatibility checks</li>
            <li>Clear part selection workflow</li>
            <li>Export options (PDF + screenshot)</li>
            <li>Easy editing with category jump links</li>
            <li>Build history saved to “My Builds”</li>
          </ul>
        </section>
      </div>
    `;

    // clear selection detail panel while in overview
    const sd = document.getElementById("selectionDetail");
    if (sd) sd.innerHTML = `<h3>OVERVIEW</h3><p class="sd-note">Use the Overview screen to review and adjust your build.</p>`;
  }

  // Remove helper called from Overview
  window.bmOverviewRemove = function (name) {
    // find item index in selectedItems by name
    const items = ensureArray(window.selectedItems || selectedItems);
    const idx = items.findIndex(it => String(it.name) === String(name));
    if (idx >= 0) {
      // removeItem expects index
      removeItem(idx);
      // re-render overview after removal
      renderOverview();
    }
  };

  window.showOverviewView = function () {
    // nav highlight
    document.querySelectorAll(".top-nav .nav-link").forEach(a => a.classList.remove("active"));
    renderOverview();
  };

  // If someone navigates to #overview, show it
  document.addEventListener("DOMContentLoaded", function () {
    if (String(location.hash||"").toLowerCase() === "#overview") {
      setTimeout(() => window.showOverviewView && window.showOverviewView(), 80);
    }
  });
})();



/* ===== BUILDMATRIX BENCHMARK PATCH =====
   Adds a simple "BM Benchmark" score for CPU/GPU and displays it:
   - On product cards (category view)
   - In Selection Detail panel
   - In Overview list (if dataset contains it)
   NOTE: Scores are project/internal (not scraped). They can be replaced later with real benchmark datasets.
*/
(function () {
  function bmNum(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }

  // Uses meta.perf if available; otherwise estimates from tier.
  window.getBMScore = function (p) {
    if (!p) return 0;
    const cat = String(p.category || "").toLowerCase();
    const meta = (p.meta && typeof p.meta === "object") ? p.meta : {};
    const perf = bmNum(meta.perf);
    const tier = String(p.tier || "").toLowerCase();

    // If you later store real benchmarks, set meta.benchmark and we will use it.
    if (meta.benchmark !== undefined && meta.benchmark !== null) {
      return Math.round(bmNum(meta.benchmark));
    }

    // CPU scale (0–20000-ish), GPU scale (0–30000-ish) just for readable numbers.
    if (cat === "cpu") {
      if (perf) return Math.round(8000 + perf * 120); // 8000..~20000
      if (tier.includes("high")) return 18500;
      if (tier.includes("enthusi")) return 16500;
      if (tier.includes("perform")) return 14500;
      return 12000;
    }

    if (cat === "gpu") {
      if (perf) return Math.round(12000 + perf * 200); // 12000..~32000
      if (tier.includes("high")) return 30000;
      if (tier.includes("enthusi")) return 26000;
      if (tier.includes("perform")) return 22000;
      return 18000;
    }

    // other categories don't need benchmarks
    return 0;
  };

  window.getBMLabel = function (p) {
    const cat = String(p?.category || "").toLowerCase();
    if (cat === "cpu") return "BM CPU Score";
    if (cat === "gpu") return "BM GPU Score";
    return "BM Score";
  };
})();



/* ===== REAL_BENCHMARK_CLIENT =====
   Gets real PassMark scores via backend endpoint:
   /api/benchmarks?type=cpu|gpu&name=<product name>
   Cached in localStorage.
*/
(function(){
  const LS_KEY = "buildmatrix_bench_cache_v1";

  function loadCache(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch(e){ return {}; } }
  function saveCache(c){ try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch(e){} }
  function key(type, name){ return (type||"") + "::" + (name||""); }

  window.bmGetRealBenchmark = async function(product){
    if(!product) return null;
    const cat = String(product.category||"").toLowerCase();
    if(cat !== "cpu" && cat !== "gpu") return null;

    const cache = loadCache();
    const k = key(cat, product.name);
    if(cache[k]) return cache[k];

    const res = await fetch(`/api/benchmarks?type=${encodeURIComponent(cat)}&name=${encodeURIComponent(product.name)}`);
    if(!res.ok) return null;
    const data = await res.json();
    cache[k] = data;
    saveCache(cache);
    return data;
  };
})();

/* ===== REAL_BENCHMARK_CARDS =====
   After rendering a category grid, fetch PassMark for CPU/GPU cards and update the "PassMark: …" line.
   Uses bmGetRealBenchmark() and localStorage cache.
*/
(function(){
  async function bmFillBenchmarksInGrid(gridEl){
    try{
      if(!gridEl) return;
      if(typeof bmGetRealBenchmark !== "function") return;

      const cards = Array.from(gridEl.querySelectorAll('.product-card'))
        .filter(c => {
          const cat = String(c.dataset.category||"").toLowerCase();
          return cat === "cpu" || cat === "gpu";
        });

      // simple concurrency limit
      const limit = 3;
      let idx = 0;

      async function worker(){
        while(idx < cards.length){
          const my = cards[idx++];
          const name = my.dataset.name;
          const cat = String(my.dataset.category||"").toLowerCase();
          const target = my.querySelector(".bm-bench-value");
          if(!target || target.dataset.bmBench === "done") continue;

          target.textContent = "loading…";
          try{
            // Build a minimal product object for the API call (bmGetRealBenchmark expects {name, category})
            const data = await bmGetRealBenchmark({ name, category: cat });
            if(data && data.score){
              target.textContent = Number(data.score).toLocaleString();
              target.dataset.bmBench = "done";
              // optional: tiny tooltip
              my.querySelector(".bm-bench")?.setAttribute("title", `${data.source} • click a part for details + link`);
            } else {
              target.textContent = "—";
              target.dataset.bmBench = "done";
            }
          }catch(e){
            target.textContent = "—";
            target.dataset.bmBench = "done";
          }
        }
      }

      await Promise.all(Array.from({length: Math.min(limit, cards.length)}, () => worker()));
    }catch(e){}
  }

  // Hook into the BuilderStyle renderCategoryView flow by wrapping filterCategory calls.
  const _bmOldFilter = window.filterCategory;
  window.filterCategory = function(category){
    const r = _bmOldFilter ? _bmOldFilter(category) : undefined;
    // After it renders, fill benchmarks
    setTimeout(() => {
      const grid = document.getElementById("bmGrid");
      bmFillBenchmarksInGrid(grid);
    }, 30);
    return r;
  };

  // Also fill on initial load if default category view renders
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      const grid = document.getElementById("bmGrid");
      bmFillBenchmarksInGrid(grid);
    }, 160);
  });
})();

/* ===== BUILDMATRIX NEXT INNOVATION =====
   Adds:
   1) Smart compatibility checks (socket, DDR, form factor, GPU length vs case)
   2) PSU recommendation (based on CPU/GPU TDP + headroom)
   3) FPS estimator (game + resolution) using REAL PassMark scores when available
*/

(function(){
  function n(x){ const v = Number(x); return Number.isFinite(v) ? v : 0; }

  function getSelected(cat){
    try{
      const items = Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems !== "undefined" ? selectedItems : []);
      return items.find(i => String(i.category).toLowerCase() === String(cat).toLowerCase()) || null;
    }catch(e){ return null; }
  }

  function findProductByName(name){
    try{
      const all = Array.isArray(window.PRODUCTS) ? window.PRODUCTS :
                 (Array.isArray(window.products) ? window.products :
                 (window.products && typeof window.products==="object" ? Object.values(window.products).flat().filter(Boolean) : []));
      return all.find(p => String(p.name||"") === String(name||"")) || null;
    }catch(e){ return null; }
  }

  function getMeta(p){ return (p && p.meta && typeof p.meta==="object") ? p.meta : {}; }

  function parseDDR(p){
    const specs = String(p?.specs||"").toUpperCase();
    if(specs.includes("DDR5")) return "DDR5";
    if(specs.includes("DDR4")) return "DDR4";
    const m = getMeta(p);
    if(m.ddr) return String(m.ddr).toUpperCase();
    return "";
  }

  function formFactorOf(p){
    const m = getMeta(p);
    const ff = m.formFactor;
    if(Array.isArray(ff)) return ff;
    if(ff) return [String(ff)];
    const specs = String(p?.specs||"").toUpperCase();
    if(specs.includes("MINI-ITX") || specs.includes("ITX")) return ["Mini-ITX"];
    if(specs.includes("MICRO-ATX") || specs.includes("MATX")) return ["Micro-ATX","Mini-ITX"];
    return ["ATX","Micro-ATX","Mini-ITX"];
  }

  function gpuLengthOf(p){
    const m = getMeta(p);
    const len = m.length || m.gpuLength || m.gpu_len;
    return n(len);
  }

  function caseGpuMax(p){
    const m = getMeta(p);
    return n(m.gpuMaxLength);
  }

  function socketOf(p){
    const m = getMeta(p);
    if(m.socket) return String(m.socket).toUpperCase();
    const specs = String(p?.specs||"").toUpperCase();
    const sm = specs.match(/(AM\d|LGA\d+)/);
    return sm ? sm[1] : "";
  }

  function tdpOf(p){
    const m = getMeta(p);
    if(m.tdp) return n(m.tdp);
    // for PSU, fallback rough numbers from tier
    const tier = String(p?.tier||"").toLowerCase();
    if(String(p?.category||"").toLowerCase()==="gpu"){
      if(tier.includes("high")) return 450;
      if(tier.includes("enthusi")) return 320;
      if(tier.includes("perform")) return 250;
      return 160;
    }
    if(String(p?.category||"").toLowerCase()==="cpu"){
      if(tier.includes("high")) return 170;
      if(tier.includes("enthusi")) return 125;
      if(tier.includes("perform")) return 105;
      return 65;
    }
    return 0;
  }

  // ---------- PSU Recommendation ----------
  function recommendPSU(cpuP, gpuP){
    const cpuT = cpuP ? tdpOf(cpuP) : 0;
    const gpuT = gpuP ? tdpOf(gpuP) : 0;
    const base = cpuT + gpuT + 120; // rest of system
    const headroom = Math.ceil(base * 1.35); // 35% headroom
    // round up to common PSU sizes
    const steps = [450,500,550,600,650,700,750,800,850,900,1000,1200,1300,1500];
    for(const s of steps){ if(headroom <= s) return s; }
    return 1600;
  }

  // ---------- Smart Compatibility ----------
  function compatChecks(){
    const cpuSel = getSelected("cpu");
    const gpuSel = getSelected("gpu");
    const mbSel = getSelected("motherboard");
    const ramSel = getSelected("ram");
    const caseSel = getSelected("case");
    const psuSel = getSelected("psu");

    const cpuP = cpuSel ? findProductByName(cpuSel.name) : null;
    const gpuP = gpuSel ? findProductByName(gpuSel.name) : null;
    const mbP  = mbSel  ? findProductByName(mbSel.name)  : null;
    const ramP = ramSel ? findProductByName(ramSel.name) : null;
    const caseP= caseSel? findProductByName(caseSel.name): null;
    const psuP = psuSel ? findProductByName(psuSel.name) : null;

    const results = [];

    // CPU ↔ Motherboard socket
    if(cpuP && mbP){
      const s1 = socketOf(cpuP);
      const s2 = socketOf(mbP);
      if(s1 && s2 && s1 !== s2){
        results.push({ level:"bad", text:`Socket mismatch: CPU ${s1} vs Motherboard ${s2}`});
      } else {
        results.push({ level:"good", text:`Socket match: ${s1 || "OK"}`});
      }
    }

    // RAM DDR4/DDR5 ↔ Motherboard
    if(ramP && mbP){
      const d1 = parseDDR(ramP);
      const d2 = parseDDR(mbP);
      if(d1 && d2 && d1 !== d2){
        results.push({ level:"bad", text:`RAM type mismatch: RAM ${d1} vs Motherboard ${d2}`});
      } else if (d1 || d2){
        results.push({ level:"good", text:`RAM type looks compatible (${d1 || d2})`});
      }
    }

    // Motherboard ↔ Case form factor
    if(mbP && caseP){
      const mbFF = formFactorOf(mbP);
      const caseFF = formFactorOf(caseP);
      const ok = mbFF.some(x => caseFF.includes(x));
      if(!ok){
        results.push({ level:"bad", text:`Form factor mismatch: Motherboard ${mbFF.join("/")} vs Case supports ${caseFF.join("/")}`});
      } else {
        results.push({ level:"good", text:`Form factor OK: ${mbFF.find(x=>caseFF.includes(x))}`});
      }
    }

    // GPU length ↔ Case max length (if both known)
    if(gpuP && caseP){
      const gl = gpuLengthOf(gpuP);
      const max = caseGpuMax(caseP);
      if(gl && max){
        if(gl > max){
          results.push({ level:"bad", text:`GPU too long: ${gl}mm > case max ${max}mm`});
        } else {
          results.push({ level:"good", text:`GPU clearance OK: ${gl}mm ≤ ${max}mm`});
        }
      }
    }

    // PSU recommendation + warning if selected PSU is too small (if wattage known)
    if(cpuP || gpuP){
      const rec = recommendPSU(cpuP, gpuP);
      results.push({ level:"info", text:`Recommended PSU: ${rec}W (with headroom)`});
      // If PSU has wattage in meta
      if(psuP){
        const w = n(getMeta(psuP).wattage || getMeta(psuP).watts);
        if(w && w < rec){
          results.push({ level:"warn", text:`Selected PSU may be too small: ${w}W < recommended ${rec}W`});
        }
      }
    }

    return results;
  }

  // Render compatibility panel with colors
  const levelIcon = { good:"✅", bad:"❌", warn:"⚠️", info:"ℹ️" };
  function renderCompatPanel(){
    const panel = document.getElementById("compatibilityPanel");
    const list = document.getElementById("compatibilityList");
    if(!panel || !list) return;

    const checks = compatChecks().filter(Boolean);
    if(!checks.length){
      panel.style.display = "none";
      list.innerHTML = "";
      return;
    }
    panel.style.display = "block";
    list.innerHTML = checks.map(c => `<div style="margin:6px 0; opacity:.95;">${levelIcon[c.level]||"•"} ${c.text}</div>`).join("");
  }

  // ---------- FPS Estimator using PassMark ----------
  const FPS_GAMES = [
    { id:"valorant", name:"Valorant", weight: 0.55 },
    { id:"fortnite", name:"Fortnite", weight: 0.70 },
    { id:"gta5", name:"GTA V", weight: 0.82 },
    { id:"cyberpunk", name:"Cyberpunk 2077", weight: 1.20 },
  ];
  const RES = [
    { id:"1080p", name:"1080p", mult: 1.00 },
    { id:"1440p", name:"1440p", mult: 0.72 },
    { id:"4k", name:"4K", mult: 0.44 },
  ];

  function initFpsControls(){
    const g = document.getElementById("fpsGame");
    const r = document.getElementById("fpsRes");
    if(g && !g.dataset.bmInit){
      g.innerHTML = FPS_GAMES.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
      g.value = "fortnite";
      g.dataset.bmInit = "1";
      g.addEventListener("change", () => updateFPS());
    }
    if(r && !r.dataset.bmInit){
      r.innerHTML = RES.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
      r.value = "1080p";
      r.dataset.bmInit = "1";
      r.addEventListener("change", () => updateFPS());
    }
  }

  async function getPassMarkScoreForSelected(cat){
    const sel = getSelected(cat);
    if(!sel) return 0;
    const p = findProductByName(sel.name);
    if(!p) return 0;
    // Use real benchmark cache/fetch if available
    if(typeof bmGetRealBenchmark === "function"){
      const data = await bmGetRealBenchmark({ name: p.name, category: p.category });
      if(data && data.score) return n(data.score);
    }
    // fallback
    const meta = getMeta(p);
    if(meta.benchmark) return n(meta.benchmark);
    if(meta.perf){
      const perf = n(meta.perf);
      return cat === "gpu" ? (12000 + perf*200) : (8000 + perf*120);
    }
    return 0;
  }

  function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

  async function renderFPS(){
    const panel = document.getElementById("fpsPanel");
    const content = document.getElementById("fpsContent");
    if(!panel || !content) return;

    initFpsControls();

    const cpuSel = getSelected("cpu");
    const gpuSel = getSelected("gpu");

    if(!cpuSel || !gpuSel){
      panel.style.display = "none";
      content.innerHTML = "";
      return;
    }

    panel.style.display = "block";

    const gameId = document.getElementById("fpsGame")?.value || "fortnite";
    const resId = document.getElementById("fpsRes")?.value || "1080p";
    const game = FPS_GAMES.find(x=>x.id===gameId) || FPS_GAMES[1];
    const res = RES.find(x=>x.id===resId) || RES[0];

    const cpuScore = await getPassMarkScoreForSelected("cpu"); // CPU Mark
    const gpuScore = await getPassMarkScoreForSelected("gpu"); // G3D Mark

    // Simple realistic-ish estimator:
    // - GPU dominates, CPU caps high FPS games.
    // - Scale to a 1080p baseline then apply res mult and game weight.
    // Values are intentionally "estimate", not claims.
    const gpuBase = gpuScore / 110.0; // e.g., 25000 -> ~227
    const cpuCap = cpuScore / 85.0;   // e.g., 18000 -> ~212
    const est = clamp(Math.min(gpuBase, cpuCap*1.15) / game.weight * res.mult, 30, 500);

    content.innerHTML = `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div style="background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.08); padding:10px; border-radius:12px;">
          <div style="opacity:.8;">Estimated FPS</div>
          <div style="font-size:1.6rem; font-weight:900; margin-top:4px;">${Math.round(est)}</div>
          <div style="opacity:.75; font-size:.9rem; margin-top:2px;">${game.name} • ${res.name}</div>
        </div>
        <div style="background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.08); padding:10px; border-radius:12px;">
          <div style="opacity:.8;">Inputs</div>
          <div style="opacity:.9; margin-top:4px;"><b>CPU Mark:</b> ${Math.round(cpuScore).toLocaleString()}</div>
          <div style="opacity:.9; margin-top:2px;"><b>G3D Mark:</b> ${Math.round(gpuScore).toLocaleString()}</div>
          <div style="opacity:.7; font-size:.85rem; margin-top:6px;">Uses PassMark scores + a simple estimate model.</div>
        </div>
      </div>
    `;
  }

  // Hook into existing update functions
  const _oldUpdateFPS = window.updateFPS;
  window.updateFPS = function(){
    try { if(typeof _oldUpdateFPS === "function") _oldUpdateFPS(); } catch(e){}
    renderFPS();
  };

  const _oldCheckCompatibility = window.checkCompatibility;
  window.checkCompatibility = function(){
    try { if(typeof _oldCheckCompatibility === "function") _oldCheckCompatibility(); } catch(e){}
    renderCompatPanel();
  };

  // Also refresh panels after add/remove/clear
  function wrap(fnName){
    const old = window[fnName];
    if(typeof old !== "function") return;
    window[fnName] = function(){
      const r = old.apply(this, arguments);
      setTimeout(() => { try{ window.checkCompatibility(); }catch(e){} try{ window.updateFPS(); }catch(e){} }, 40);
      return r;
    };
  }
  ["addToBuild","removeItem","clearAllBuild"].forEach(wrap);

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { try{ window.checkCompatibility(); }catch(e){} try{ window.updateFPS(); }catch(e){} }, 250);
  });
})();


/* ===== BUILDMATRIX BLOCK_INCOMPATIBLE =====
   Prevent adding parts that will break compatibility.
   Uses dataset fields on cards: socket, ddr, formFactor, length, maxGpuLength.
*/
(function(){
  function up(s){ return String(s||"").toUpperCase(); }
  function low(s){ return String(s||"").toLowerCase(); }
  function num(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }

  function getSelectedCardByCategory(cat){
    const c = low(cat);
    const item = (Array.isArray(selectedItems) ? selectedItems : []).find(i => low(i.category) === c);
    if(!item) return null;
    return Array.from(document.querySelectorAll(".product-card")).find(card => card.dataset.name === item.name) || null;
  }

  function warn(msg){
    try{ showToast(msg); } catch(e){ alert(msg); }
  }

  const _oldAdd = window.addToBuild;
  window.addToBuild = function(button){
    const card = button.closest(".product-card");
    if(!card) return;

    const cat = low(card.dataset.category);
    const socket = up(card.dataset.socket);
    const ddr = up(card.dataset.ddr);
    const ff = up(card.dataset.formfactor || card.dataset.formFactor);
    const gpuLen = num(card.dataset.length);
    const caseMax = num(card.dataset.maxgpulength || card.dataset.maxGpuLength);

    // Read existing selected datasets
    const cpuCard = getSelectedCardByCategory("cpu");
    const mbCard  = getSelectedCardByCategory("motherboard");
    const ramCard = getSelectedCardByCategory("ram");
    const caseCard= getSelectedCardByCategory("case");
    const gpuCard = getSelectedCardByCategory("gpu");

    // Socket rules
    if((cat==="cpu" || cat==="motherboard") && socket){
      const other = (cat==="cpu") ? (mbCard ? up(mbCard.dataset.socket) : "") : (cpuCard ? up(cpuCard.dataset.socket) : "");
      if(other && other !== socket){
        return warn(`❌ Not compatible: socket mismatch (${socket} vs ${other})`);
      }
    }

    // DDR rules (ram vs motherboard)
    if((cat==="ram" || cat==="motherboard") && ddr){
      const other = (cat==="ram") ? (mbCard ? up(mbCard.dataset.ddr) : "") : (ramCard ? up(ramCard.dataset.ddr) : "");
      if(other && other !== ddr){
        return warn(`❌ Not compatible: RAM type mismatch (${ddr} vs ${other})`);
      }
    }

    // Form factor rules (motherboard vs case) — smarter: allow overlap (cases can support multiple sizes)
    if (cat==="case" || cat==="motherboard") {
      const myFFRaw = (cat==="case") ? (card.dataset.formfactor || card.dataset.formFactor) : (card.dataset.formfactor || card.dataset.formFactor);
      const otherRaw = (cat==="case") ? (mbCard ? (mbCard.dataset.formfactor || mbCard.dataset.formFactor) : "") : (caseCard ? (caseCard.dataset.formfactor || caseCard.dataset.formFactor) : "");

      const parseFF = (raw) => String(raw||"")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.toUpperCase());

      const myList = parseFF(myFFRaw);
      const otherList = parseFF(otherRaw);

      // If either side missing info, don't block.
      if (myList.length && otherList.length) {
        // overlap if any ff matches
        const ok = myList.some(x => otherList.includes(x));
        if (!ok) {
          return warn(`❌ Not compatible: form factor mismatch (${myList.join("/")} vs ${otherList.join("/")})`);
        }
      }
    }

    // GPU length vs case max
    if(cat==="gpu" && caseCard){
      const max = num(caseCard.dataset.maxgpulength || caseCard.dataset.maxGpuLength);
      if(gpuLen && max && gpuLen > max){
        return warn(`❌ Not compatible: GPU too long (${gpuLen}mm > case max ${max}mm)`);
      }
    }
    if(cat==="case" && gpuCard){
      const gl = num(gpuCard.dataset.length);
      if(caseMax && gl && gl > caseMax){
        return warn(`❌ Not compatible: current GPU too long for this case (${gl}mm > ${caseMax}mm)`);
      }
    }

    return _oldAdd(button);
  };
})();

/* ===== BUILDMATRIX QUANTITY PATCH =====
   Quantity for: RAM / SSD / HDD
   - Clicking "+ Add to Build" again increases qty
   - Remove decreases qty (until 0)
   - Sidebar shows qty + subtotal + +/-
*/
(function(){
  const MULTI_QTY = new Set(["ram","ssd","hdd","fan","monitor"]);
  const low = (s) => String(s||"").toLowerCase();
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

  const _oldAdd = window.addToBuild;
  window.addToBuild = function(button){
    const card = button?.closest?.(".product-card");
    if(!card) return _oldAdd(button);

    const category = low(card.dataset.category);
    if(!MULTI_QTY.has(category)) return _oldAdd(button);

    const price = parseInt(card.dataset.price || "0", 10);
    const name = card.dataset.name || "Component";

    const existing = (Array.isArray(selectedItems) ? selectedItems : []).find(it => low(it.category)===category && it.name===name);
    if(existing){
      existing.qty = (num(existing.qty) || 1) + 1;
      currentTotal += price;
      card.classList.add("selected");
      button.textContent = "✓ Added";
      showToast(`${name} quantity: ${existing.qty}`);
      updateBuildDisplay();
      syncSelectedCardsUI();
      try{ checkCompatibility(); }catch(e){}
      try{ updateFPS(); }catch(e){}
      return;
    }

    _oldAdd(button);
    const added = (Array.isArray(selectedItems) ? selectedItems : []).find(it => low(it.category)===category && it.name===name);
    if(added && !added.qty) added.qty = 1;
    updateBuildDisplay();
  };

  const _oldRemove = window.removeItem;
  window.removeItem = function(index){
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const it = items[index];
    if(it && MULTI_QTY.has(low(it.category)) && (num(it.qty) || 1) > 1){
      it.qty = (num(it.qty) || 1) - 1;
      currentTotal -= num(it.price);
      showToast(`${it.name} quantity: ${it.qty}`);
      updateBuildDisplay();
      syncSelectedCardsUI();
      try{ checkCompatibility(); }catch(e){}
      try{ updateFPS(); }catch(e){}
      return;
    }
    return _oldRemove(index);
  };

  window.increaseQty = function(index){
    const items = Array.isArray(selectedItems) ? selectedItems : [];
    const it = items[index];
    if(!it || !MULTI_QTY.has(low(it.category))) return;
    it.qty = (num(it.qty) || 1) + 1;
    currentTotal += num(it.price);
    showToast(`${it.name} quantity: ${it.qty}`);
    updateBuildDisplay();
    syncSelectedCardsUI();
    try{ checkCompatibility(); }catch(e){}
    try{ updateFPS(); }catch(e){}
  };

  window.decreaseQty = function(index){
    window.removeItem(index);
  };

  const _oldUpdate = window.updateBuildDisplay;
  window.updateBuildDisplay = function(){
    _oldUpdate();

    const container = document.getElementById("selectedParts");
    if(!container) return;

    const rows = Array.from(container.querySelectorAll(".selected-item"));
    const items = Array.isArray(selectedItems) ? selectedItems : [];

    rows.forEach((row, i) => {
      const it = items[i];
      if(!it || !MULTI_QTY.has(low(it.category))) return;
      if(row.querySelector(".bm-qty-chip")) return;

      const qty = num(it.qty) || 1;
      const sub = qty * num(it.price);

      const right = row.querySelector(".selected-item-right") || row;

      const wrap = document.createElement("div");
      wrap.style.marginTop = "8px";
      wrap.style.display = "flex";
      wrap.style.justifyContent = "space-between";
      wrap.style.alignItems = "center";
      wrap.style.gap = "10px";

      wrap.className = "bm-qty-row";
      wrap.innerHTML = `
        <div class="bm-qty-meta">
          <span class="bm-qty-chip">Qty: ${qty}</span>
          <span class="bm-qty-chip subtotal">Subtotal: ₱${sub.toLocaleString()}</span>
        </div>
        <div class="bm-qty-actions">
          <button class="bm-qty-btn" type="button" onclick="decreaseQty(${i})" aria-label="Decrease quantity">−</button>
          <button class="bm-qty-btn" type="button" onclick="increaseQty(${i})" aria-label="Increase quantity">+</button>
        </div>
      `;
      right.appendChild(wrap);
    });
  };
})();

/* ===== BUILDMATRIX BETTER OVERVIEW =====
   Replaces Overview screen with:
   - grouped list + per-item qty/subtotal
   - +/- for RAM/SSD/HDD
   - clearer totals + quick jump buttons
*/
(function(){
  const MULTI_QTY = new Set(["ram","ssd","hdd","fan","monitor"]);
  const low = (s)=>String(s||"").toLowerCase();
  const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };

  function escape(s){ return (typeof escapeHtml==="function") ? escapeHtml(String(s||"")) : String(s||""); }

  function items(){
    return Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
  }

  function categoryLabel(c){
    const map={cpu:"CPU",gpu:"GPU",motherboard:"Motherboard",ram:"RAM",ssd:"SSD",hdd:"HDD",psu:"PSU",case:"Case",monitor:"Monitor",keyboard:"Keyboard",mouse:"Mouse"};
    return map[low(c)] || String(c||"").toUpperCase();
  }

  window.showOverviewView = function(){
    const main = document.getElementById("mainContent");
    if(!main) return;

    const list = items();
    const total = Number(window.currentTotal ?? (typeof currentTotal!=="undefined"?currentTotal:0));

    if(!list.length){
      main.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <div>
            <h2 style="margin:0;">Overview</h2>
            <div style="opacity:.8; margin-top:4px;">No parts selected yet. Add parts from the Builder.</div>
          </div>
          <button class="dark-mode-toggle" type="button" onclick="showAllProducts()"><i class="fas fa-wrench"></i> Back</button>
        </div>
      `;
      return;
    }

    const rows = list.map((it, idx) => {
      const price = num(it.price);
      const qty = num(it.qty) || 1;
      const sub = price * qty;
      const cat = low(it.category);

      const qtyUI = MULTI_QTY.has(cat) ? `
        <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:8px;">
          <button class="bm-qty-btn" type="button" onclick="decreaseQty(${idx}); showOverviewView();">−</button>
          <button class="bm-qty-btn" type="button" onclick="increaseQty(${idx}); showOverviewView();">+</button>
        </div>` : ``;

      return `
        <div style="border:1px solid rgba(0,0,0,0.08); background: rgba(0,0,0,0.02); border-radius:14px; padding:12px; display:flex; justify-content:space-between; gap:12px;">
          <div style="min-width:0;">
            <div style="font-size:.75rem; opacity:.8; font-weight:900; letter-spacing:.04em;">${escape(categoryLabel(cat))}</div>
            <div style="font-weight:900; margin-top:4px; line-height:1.25;">${escape(it.name)}</div>
            ${it.dataset && it.dataset.specs ? `<div style="opacity:.8; font-size:.9rem; margin-top:6px;">${escape(it.dataset.specs)}</div>` : ""}
            <div class="bm-qty-row" style="margin-top:10px;">
              <span class="bm-qty-chip">Qty: ${qty}</span>
              <span class="bm-qty-chip">Unit: ₱${price.toLocaleString()}</span>
              <span class="bm-qty-chip">Subtotal: ₱${sub.toLocaleString()}</span>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end; white-space:nowrap;">
            <button class="ov-link" type="button" onclick="filterCategory('${escape(cat)}')">Change</button>
            <button class="ov-link" type="button" onclick="bmOverviewRemove('${escape(it.name).replaceAll("'","&#39;")}'); showOverviewView();">Remove all</button>
            ${qtyUI}
          </div>
        </div>
      `;
    }).join("");

    main.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom: 12px;">
        <div>
          <h2 style="margin:0;">Overview</h2>
          <div style="opacity:.8; margin-top:4px;">Review quantities and totals before saving.</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="dark-mode-toggle" type="button" onclick="showAllProducts()"><i class="fas fa-wrench"></i> Back to Builder</button>
          <button class="save-build-btn" type="button" onclick="saveCurrentBuild()"><i class="fas fa-save"></i> Save Build</button>
          <button class="pdf-btn" type="button" onclick="downloadPDF()"><i class="fas fa-file-pdf"></i> Save PDF</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1.7fr 1fr; gap:14px;">
        <section style="background: var(--card-bg); border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:14px;">
          <h3 style="margin:0 0 12px;">Selected Parts</h3>
          <div style="display:flex; flex-direction:column; gap:10px;">${rows}</div>
        </section>

        <aside style="background: var(--card-bg); border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:14px; height: fit-content;">
          <h3 style="margin:0 0 10px;">Totals</h3>
          <div style="display:flex; justify-content:space-between; font-weight:900; font-size:1.1rem;">
            <span>Total</span>
            <span>₱${total.toLocaleString()}</span>
          </div>
          <div style="opacity:.75; margin-top:8px; font-size:.9rem;">
            Tip: RAM/SSD/HDD supports quantities. Use + / − to adjust.
          </div>
          <button class="clear-all-btn" type="button" style="margin-top:12px; width:100%;" onclick="clearAllBuild(); showOverviewView();">
            Clear All Parts
          </button>
        </aside>
      </div>
    `;

    const sd = document.getElementById("selectionDetail");
    if(sd) sd.innerHTML = `<h3>OVERVIEW</h3><p class="sd-note">Adjust quantities here, then save your build.</p>`;
  };
})();

/* ===== BUILDMATRIX POLISH JS =====
   Small UX improvements only:
   - clearer empty states
   - avoids flashing when switching views
*/
(function(){
  // If selection detail panel exists and is empty, show a friendly hint.
  document.addEventListener("DOMContentLoaded", () => {
    try{
      const sd = document.getElementById("selectionDetail");
      if(sd && !sd.innerText.trim()){
        sd.innerHTML = `<h3>SELECT A PART</h3><p class="sd-note">Click any product to preview its full specifications here.</p>`;
      }
    }catch(e){}
  });
})();

/* ===== BUILDMATRIX COMPARE + AUTOBUILD =====
   Adds:
   - Compare modal (CPU/GPU) with PassMark + value score
   - Auto Build generator (budget + purpose) with Apply-to-build
   - Value meter (score per peso) displayed on CPU/GPU cards after PassMark loads
*/
(function(){
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const low = (s) => String(s||"").toLowerCase();

  function getAll(){
    if (Array.isArray(window.PRODUCTS)) return window.PRODUCTS;
    if (Array.isArray(window.products)) return window.products;
    if (window.products && typeof window.products === "object") return Object.values(window.products).flat().filter(Boolean);
    return [];
  }

  // ----- Modal helpers -----
  window.openCompareModal = function(){
    const m = document.getElementById("compareModal");
    if(!m) return;
    m.style.display = "flex";
    window.populateCompareSelects && window.populateCompareSelects();
  };
  window.closeCompareModal = function(){
    const m = document.getElementById("compareModal");
    if(m) m.style.display = "none";
  };

  window.openAutoBuildModal = function(){
    const m = document.getElementById("autoBuildModal");
    if(!m) return;
    m.style.display = "flex";
    const btn = document.getElementById("bmApplyBuildBtn");
    if(btn) btn.disabled = true;
    const out = document.getElementById("bmAutoBuildResult");
    if(out) out.innerHTML = "";
  };
  window.closeAutoBuildModal = function(){
    const m = document.getElementById("autoBuildModal");
    if(m) m.style.display = "none";
  };

  // close on overlay click
  window.addEventListener("click", (e) => {
    const cm = document.getElementById("compareModal");
    const am = document.getElementById("autoBuildModal");
    if(cm && e.target === cm) closeCompareModal();
    if(am && e.target === am) closeAutoBuildModal();
  });

  // ----- Compare -----
  function listByType(type){
    const t = low(type);
    return getAll().filter(p => low(p.category) === t);
  }

  window.populateCompareSelects = function(){
    const type = document.getElementById("bmCompareType")?.value || "cpu";
    const a = document.getElementById("bmCompareA");
    const b = document.getElementById("bmCompareB");
    if(!a || !b) return;
    const list = listByType(type).slice().sort((x,y)=>String(x.name).localeCompare(String(y.name)));
    a.innerHTML = list.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    b.innerHTML = list.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    if(list.length){
      a.value = list[0].id;
      b.value = list[Math.min(1, list.length-1)].id;
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const t = document.getElementById("bmCompareType");
    if(t){ t.addEventListener("change", () => window.populateCompareSelects && window.populateCompareSelects()); }
  });

  window.swapCompare = function(){
    const a = document.getElementById("bmCompareA");
    const b = document.getElementById("bmCompareB");
    if(!a || !b) return;
    const tmp = a.value; a.value = b.value; b.value = tmp;
  };

  async function passmarkFor(p){
    if(!p) return null;
    const cat = low(p.category);
    if(cat !== "cpu" && cat !== "gpu") return null;
    if(typeof bmGetRealBenchmark === "function"){
      const d = await bmGetRealBenchmark({ name: p.name, category: cat });
      if(d && d.score) return d;
    }
    return null;
  }

  function valueScore(score, price){
    if(!score || !price) return 0;
    // scaled for readability
    return Math.round((num(score) / num(price)) * 1000);
  }

  window.runCompare = async function(){
    const type = document.getElementById("bmCompareType")?.value || "cpu";
    const ida = document.getElementById("bmCompareA")?.value;
    const idb = document.getElementById("bmCompareB")?.value;
    const out = document.getElementById("bmCompareResult");
    if(!out) return;

    const list = listByType(type);
    const A = list.find(p=>p.id===ida);
    const B = list.find(p=>p.id===idb);
    if(!A || !B){
      out.innerHTML = `<div style="opacity:.8;">Pick two parts to compare.</div>`;
      return;
    }

    out.innerHTML = `<div style="opacity:.8;">Loading PassMark…</div>`;

    const [pa, pb] = await Promise.all([passmarkFor(A), passmarkFor(B)]);
    const sa = pa?.score || 0;
    const sb = pb?.score || 0;

    const va = valueScore(sa, A.price);
    const vb = valueScore(sb, B.price);

    const label = (low(type)==="cpu") ? "PassMark CPU Mark" : "PassMark G3D Mark";

    const card = (p, s, v, src) => `
      <div style="border:1px solid rgba(0,0,0,0.10); border-radius:18px; padding:14px; background: rgba(0,0,0,0.02);">
        <div style="font-weight:900; font-size:1.05rem;">${p.name}</div>
        <div style="opacity:.8; margin-top:4px;">${p.specs || ""}</div>

        <div class="bm-stat" style="margin-top:12px;">
          <span><b>Price</b></span><span>₱${num(p.price).toLocaleString()}</span>
        </div>
        <div class="bm-stat">
          <span><b>${label}</b></span><span>${s ? num(s).toLocaleString() : "Unavailable"}</span>
        </div>
        <div class="bm-stat">
          <span><b>Value Score</b> <span style="opacity:.7;">(score/₱)</span></span><span>${v ? v : "—"}</span>
        </div>
        ${src?.url ? `<div style="margin-top:10px;"><a href="${src.url}" target="_blank" style="opacity:.85;">View source</a></div>` : ""}
      </div>
    `;

    // winner badge
    const winBench = sa && sb ? (sa>sb ? "A" : (sb>sa ? "B" : "Tie")) : "—";
    const winValue = va && vb ? (va>vb ? "A" : (vb>va ? "B" : "Tie")) : "—";

    out.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <span class="bm-pill">Winner (Benchmark): <b style="margin-left:6px;">${winBench}</b></span>
        <span class="bm-pill">Winner (Value): <b style="margin-left:6px;">${winValue}</b></span>
      </div>
      <div class="bm-compare-grid">
        ${card(A, sa, va, pa)}
        ${card(B, sb, vb, pb)}
      </div>
    `;
  };

  // ----- Auto Build -----
  // Very practical ruleset:
  // - Always picks CPU+MB (matching socket), RAM, Storage, PSU, Case, (GPU depending on budget/purpose)
  // - Uses tiers and budget split. Keeps it compatible.
  let lastAutoBuild = null;

  function pickBest(list, predicate){
    const f = list.filter(predicate);
    return f.length ? f[0] : null;
  }

  function byPriceDesc(a,b){ return num(b.price)-num(a.price); }
  function byPriceAsc(a,b){ return num(a.price)-num(b.price); }

  function getSocket(p){
    const s = p?.meta?.socket || "";
    const m = String(p?.specs||"").toUpperCase().match(/(AM\d|LGA\d+)/);
    return String(s|| (m?m[1]:"")).toUpperCase();
  }

  function ddrType(p){
    const d = p?.meta?.ddr || "";
    const s = String(p?.specs||"").toUpperCase();
    if(s.includes("DDR5")) return "DDR5";
    if(s.includes("DDR4")) return "DDR4";
    return String(d).toUpperCase();
  }

  function watt(p){
    return num(p?.meta?.wattage || p?.meta?.watts || p?.meta?.tdp || 0);
  }

  function recommendPSU(cpu, gpu){
    const base = watt(cpu) + watt(gpu) + 120;
    const need = Math.ceil(base*1.35);
    const steps=[450,500,550,600,650,700,750,800,850,900,1000,1200,1300,1500];
    return steps.find(x=>need<=x) || 1600;
  }

  function valueKey(p, score){
    const v = valueScore(score, p.price);
    return v;
  }

  async function realScore(p){
    const cat = low(p.category);
    if(cat!=="cpu" && cat!=="gpu") return 0;
    const d = await passmarkFor(p);
    return d?.score || 0;
  }

  function fmtLine(p, extra=""){
    if(!p) return "";
    return `<div class="bm-stat"><span><b>${p.category.toUpperCase()}</b> — ${p.name}</span><span>₱${num(p.price).toLocaleString()} ${extra}</span></div>`;
  }

  window.generateAutoBuild = async function(){
    const budget = num(document.getElementById("bmBudget")?.value || 0);
    const purpose = document.getElementById("bmPurpose")?.value || "gaming";
    const pref = document.getElementById("bmPreference")?.value || "balanced";
    const out = document.getElementById("bmAutoBuildResult");
    const applyBtn = document.getElementById("bmApplyBuildBtn");
    if(!out) return;
    out.innerHTML = `<div style="opacity:.8;">Generating…</div>`;
    if(applyBtn) applyBtn.disabled = true;

    const all = getAll();
    const cpus = all.filter(p=>low(p.category)==="cpu").sort(byPriceDesc);
    const gpus = all.filter(p=>low(p.category)==="gpu").sort(byPriceDesc);
    const mbs  = all.filter(p=>low(p.category)==="motherboard").sort(byPriceDesc);
    const rams = all.filter(p=>low(p.category)==="ram").sort(byPriceDesc);
    const ssds = all.filter(p=>low(p.category)==="ssd").sort(byPriceDesc);
    const psus = all.filter(p=>low(p.category)==="psu").sort(byPriceAsc);
    const cases= all.filter(p=>low(p.category)==="case").sort(byPriceAsc);
    const fans = all.filter(p=>low(p.category)==="fan").sort(byPriceAsc);

    // budget split
    let gpuShare = 0.38;
    let cpuShare = 0.22;
    if(purpose==="editing"){ gpuShare=0.30; cpuShare=0.28; }
    if(purpose==="school"){ gpuShare=0.10; cpuShare=0.22; }
    if(purpose==="streaming"){ gpuShare=0.34; cpuShare=0.26; }
    if(pref==="gpu") gpuShare += 0.10;
    if(pref==="cpu") cpuShare += 0.08;
    if(pref==="value"){ gpuShare -= 0.05; cpuShare -= 0.05; }

    const gpuBudget = Math.max(0, Math.floor(budget * gpuShare));
    const cpuBudget = Math.max(0, Math.floor(budget * cpuShare));

    // choose CPU near cpuBudget (but not over too much)
    const cpu = pickBest(cpus, p => num(p.price) <= cpuBudget) || cpus.slice(-1)[0] || null;

    // pick motherboard matching socket and within a reasonable price
    const sock = getSocket(cpu);
    const mb = pickBest(mbs, p => getSocket(p)===sock && num(p.price) <= Math.max(8000, Math.floor(cpuBudget*0.7))) || pickBest(mbs, p=>getSocket(p)===sock) || null;

    // RAM type match motherboard (DDR4/DDR5) if possible; choose 16GB-ish by tier (simple)
    const mbDDR = ddrType(mb);
    const ram = pickBest(rams, p => (!mbDDR || ddrType(p)===mbDDR) && num(p.price) <= 5500) || pickBest(rams, p => (!mbDDR || ddrType(p)===mbDDR)) || rams[0] || null;

    // Storage: pick 1 SSD
    const ssd = pickBest(ssds, p => num(p.price) <= 4500) || ssds[0] || null;

    // GPU: if budget allows or purpose gaming/streaming/editing
    let gpu = null;
    if(purpose!=="school"){
      gpu = pickBest(gpus, p => num(p.price) <= gpuBudget) || pickBest(gpus, p => num(p.price) <= Math.max(12000, gpuBudget)) || null;
    } else {
      gpu = pickBest(gpus, p => num(p.price) <= 12000) || null; // optional
    }

    // Case + PSU: pick affordable, PSU based on recommendation
    const pcCase = cases[0] || null;
    const rec = recommendPSU(cpu, gpu);
    const psu = pickBest(psus, p => num(p.meta?.wattage) >= rec) || psus.slice(-1)[0] || null;

    // Fans: 2 fans by default (qty) if budget allows
    const fan = fans[0] || null;
    const fanQty = (fan && budget >= 35000) ? 2 : 0;

    // Calculate total estimate
    const parts = [cpu, mb, ram, ssd, gpu, psu, pcCase].filter(Boolean);
    let total = parts.reduce((s,p)=>s+num(p.price),0) + (fan ? fanQty*num(fan.price) : 0);

    // Value mode: use benchmark/price to pick CPU+GPU best value within budgets
    if(pref==="value" && (cpu || gpu)){
      // try re-pick CPU based on value within cpuBudget
      const cpuCandidates = cpus.filter(p=>num(p.price)<=cpuBudget).slice(0,8);
      if(cpuCandidates.length){
        const scores = await Promise.all(cpuCandidates.map(realScore));
        const pairs = cpuCandidates.map((p,i)=>({p, score:scores[i], val:valueKey(p,scores[i])})).sort((a,b)=>b.val-a.val);
        if(pairs[0]?.p) {
          const newCPU = pairs[0].p;
          const newSock = getSocket(newCPU);
          const newMB = pickBest(mbs, x=>getSocket(x)===newSock) || mb;
          parts[0]=newCPU;
          parts[1]=newMB;
        }
      }
      // re-pick GPU based on value within gpuBudget
      if(gpuBudget>0){
        const gpuCandidates = gpus.filter(p=>num(p.price)<=gpuBudget).slice(0,8);
        if(gpuCandidates.length){
          const scores = await Promise.all(gpuCandidates.map(realScore));
          const pairs = gpuCandidates.map((p,i)=>({p, score:scores[i], val:valueKey(p,scores[i])})).sort((a,b)=>b.val-a.val);
          gpu = pairs[0]?.p || gpu;
        }
      }
    }

    // Recompute total after any value swaps
    const finalParts = [parts[0], parts[1], ram, ssd, gpu, psu, pcCase].filter(Boolean);
    total = finalParts.reduce((s,p)=>s+num(p.price),0) + (fan ? fanQty*num(fan.price) : 0);

    lastAutoBuild = { parts: finalParts, fan, fanQty, budget, total, recPSU: rec };

    // Render results
    out.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <span class="bm-pill">Budget: ₱${budget.toLocaleString()}</span>
        <span class="bm-pill">Estimated Total: ₱${total.toLocaleString()}</span>
        <span class="bm-pill">Recommended PSU: ${rec}W</span>
      </div>
      ${fmtLine(cpu)}
      ${fmtLine(mb)}
      ${fmtLine(ram, '<span style="opacity:.75;">(Qty 1)</span>')}
      ${fmtLine(ssd, '<span style="opacity:.75;">(Qty 1)</span>')}
      ${gpu ? fmtLine(gpu) : '<div style="opacity:.75; margin-top:8px;">GPU: (optional / not selected)</div>'}
      ${fmtLine(psu)}
      ${fmtLine(pcCase)}
      ${fanQty ? `<div class="bm-stat"><span><b>FAN</b> — ${fan.name}</span><span>₱${num(fan.price).toLocaleString()} × ${fanQty}</span></div>` : ""}
      <div style="opacity:.75; margin-top:10px; font-size:.9rem;">Tip: Click “Apply to Build” to load this build into your builder sidebar.</div>
    `;

    if(applyBtn) applyBtn.disabled = false;
  };

  // Apply build by directly setting selectedItems/currentTotal (fast and reliable)
  window.applyAutoBuild = function(){
    if(!lastAutoBuild) return;
    try{
      clearAllBuild();
    }catch(e){}

    const all = getAll();

    function makeSelected(p){
      const meta = p.meta && typeof p.meta==="object" ? p.meta : {};
      const ds = {
        id: String(p.id||""),
        name: String(p.name||""),
        category: String(p.category||""),
        price: String(p.price||"0"),
        specs: String(p.specs||""),
        perf: String(meta.perf||""),
        socket: String(meta.socket||""),
        tdp: String(meta.tdp||""),
        length: String(meta.length||""),
        maxGpuLength: String(meta.gpuMaxLength||meta.maxGpuLength||""),
        wattage: String(meta.wattage||meta.watts||""),
        formFactor: Array.isArray(meta.formFactor) ? meta.formFactor.join(",") : String(meta.formFactor||""),
        ddr: String(meta.ddr||"")
      };
      return { name: p.name, price: num(p.price), category: low(p.category), dataset: ds, qty: 1 };
    }

    // set selectedItems
    const parts = lastAutoBuild.parts || [];
    const fans = lastAutoBuild.fan ? [lastAutoBuild.fan] : [];
    const fanQty = lastAutoBuild.fanQty || 0;

    const sel = [];
    let total = 0;

    parts.forEach(p=>{
      const item = makeSelected(p);
      sel.push(item);
      total += num(p.price);
    });

    if(fans.length && fanQty>0){
      const item = makeSelected(fans[0]);
      item.qty = fanQty;
      sel.push(item);
      total += fanQty * num(fans[0].price);
    }

    window.selectedItems = sel;
    if(typeof selectedItems !== "undefined") selectedItems = sel;
    window.currentTotal = total;
    if(typeof currentTotal !== "undefined") currentTotal = total;

    try{ updateBuildDisplay(); }catch(e){}
    try{ syncSelectedCardsUI(); }catch(e){}
    try{ checkCompatibility(); }catch(e){}
    try{ updateFPS(); }catch(e){}

    closeAutoBuildModal();
    showToast("✅ Auto build applied!");
  };

  // ----- Value meter on cards -----
  // Extend the benchmark card fill to also show a value line.
  function ensureValueLine(card){
    if(card.querySelector(".bm-value")) return;
    const el = document.createElement("div");
    el.className = "bm-value";
    el.style.margin = "6px 0 0";
    el.style.opacity = ".85";
    el.style.fontWeight = "900";
    el.innerHTML = `Value: <span class="bm-value-val">—</span>`;
    const bench = card.querySelector(".bm-bench");
    if(bench) bench.insertAdjacentElement("afterend", el);
    else card.querySelector(".product-info")?.appendChild(el);
  }

  async function fillValueInGrid(){
    const grid = document.getElementById("bmGrid");
    if(!grid || typeof bmGetRealBenchmark !== "function") return;
    const cards = Array.from(grid.querySelectorAll(".product-card")).filter(c=>["cpu","gpu"].includes(low(c.dataset.category)));
    for(const c of cards){
      ensureValueLine(c);
    }
    // concurrency limited
    const limit=3; let i=0;
    async function worker(){
      while(i<cards.length){
        const card = cards[i++];
        const name = card.dataset.name;
        const cat = low(card.dataset.category);
        const price = num(card.dataset.price);
        const target = card.querySelector(".bm-value-val");
        if(!target) continue;
        try{
          const d = await bmGetRealBenchmark({ name, category: cat });
          if(d && d.score){
            target.textContent = valueScore(d.score, price);
          } else {
            target.textContent = "—";
          }
        }catch(e){
          target.textContent = "—";
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(limit,cards.length)},()=>worker()));
  }

  // hook after category render
  const _oldFilter = window.filterCategory;
  window.filterCategory = function(cat){
    const r = _oldFilter ? _oldFilter(cat) : undefined;
    setTimeout(() => { fillValueInGrid(); }, 160);
    return r;
  };
  document.addEventListener("DOMContentLoaded", () => setTimeout(fillValueInGrid, 400));
})();

/* ===== BUILDMATRIX SHARE+VIZ+FIXIT =====
   - Share link: encodes current build into ?b=... and copies to clipboard
   - Load shared build on page load
   - Build visualizer panel (quick glance of filled slots + quantities)
   - Compatibility panel "Fix" buttons (auto-replace compatible parts)
*/
(function(){
  const low = (s)=>String(s||"").toLowerCase();
  const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };

  function getAll(){
    if (Array.isArray(window.PRODUCTS)) return window.PRODUCTS;
    if (Array.isArray(window.products)) return window.products;
    if (window.products && typeof window.products === "object") return Object.values(window.products).flat().filter(Boolean);
    return [];
  }

  function findByName(name){
    return getAll().find(p => String(p.name||"") === String(name||"")) || null;
  }

  function buildPayload(){
    const items = Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
    return items.map(it => ({
      name: it.name,
      category: it.category,
      price: it.price,
      qty: it.qty || 1
    }));
  }

  function encodePayload(payload){
    const json = JSON.stringify(payload);
    // safe base64url
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return b64;
  }

  function decodePayload(b64){
    const s = b64.replace(/-/g,'+').replace(/_/g,'/');
    const pad = s + "===".slice((s.length + 3) % 4);
    const json = decodeURIComponent(escape(atob(pad)));
    return JSON.parse(json);
  }

  window.copyShareLink = async function(){
    try{
      const payload = buildPayload();
      if(!payload.length){
        showToast("Add parts first to create a link.");
        return;
      }
      const b64 = encodePayload(payload);
      const url = `${location.origin}${location.pathname}?b=${b64}`;
      await navigator.clipboard.writeText(url);
      showToast("🔗 Share link copied!");
    }catch(e){
      try{
        const payload = buildPayload();
        const b64 = encodePayload(payload);
        const url = `${location.origin}${location.pathname}?b=${b64}`;
        prompt("Copy this link:", url);
      }catch(e2){}
    }
  };

  function applyPayload(payload){
    if(!Array.isArray(payload)) return;
    try{ clearAllBuild(); }catch(e){}

    const all = getAll();
    const sel = [];
    let total = 0;

    for(const x of payload){
      const p = all.find(p => low(p.category)===low(x.category) && String(p.name)===String(x.name)) 
             || all.find(p => String(p.name)===String(x.name));
      if(!p) continue;
      const meta = (p.meta && typeof p.meta==="object") ? p.meta : {};
      const ds = {
        id: String(p.id||""),
        name: String(p.name||""),
        category: String(p.category||""),
        price: String(p.price||"0"),
        specs: String(p.specs||""),
        perf: String(meta.perf||""),
        socket: String(meta.socket||""),
        tdp: String(meta.tdp||""),
        length: String(meta.length||""),
        maxGpuLength: String(meta.gpuMaxLength||meta.maxGpuLength||""),
        wattage: String(meta.wattage||meta.watts||""),
        formFactor: Array.isArray(meta.formFactor) ? meta.formFactor.join(",") : String(meta.formFactor||""),
        ddr: String(meta.ddr||"")
      };
      const qty = Math.max(1, Number(x.qty||1));
      sel.push({ name: p.name, price: Number(p.price||0), category: low(p.category), dataset: ds, qty });
      total += qty * Number(p.price||0);
    }

    window.selectedItems = sel;
    if(typeof selectedItems !== "undefined") selectedItems = sel;
    window.currentTotal = total;
    if(typeof currentTotal !== "undefined") currentTotal = total;

    try{ updateBuildDisplay(); }catch(e){}
    try{ syncSelectedCardsUI(); }catch(e){}
    try{ checkCompatibility(); }catch(e){}
    try{ updateFPS(); }catch(e){}
    try{ showToast("✅ Build loaded from link"); }catch(e){}
  }

  function loadSharedFromQuery(){
    try{
      const params = new URLSearchParams(location.search);
      const b = params.get("b");
      if(!b) return;
      const payload = decodePayload(b);
      applyPayload(payload);
    }catch(e){}
  }

  // ----- Build Visualizer -----
  function renderVisualizer(){
    const box = document.getElementById("buildVisualizer");
    if(!box) return;

    const items = Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
    const get = (cat) => items.find(i => low(i.category)===cat) || null;
    const qty = (cat) => items.filter(i => low(i.category)===cat).reduce((s,i)=>s + Number(i.qty||1),0);

    const slots = [
      ["cpu","CPU"],
      ["gpu","GPU"],
      ["motherboard","MB"],
      ["ram","RAM"],
      ["ssd","SSD"],
      ["hdd","HDD"],
      ["psu","PSU"],
      ["case","Case"],
      ["fan","Fans"],
    ];

    const badge = (ok, text) => `<span class="bm-viz-badge">${ok ? "✓" : "—"} ${text}</span>`;

    const cards = slots.map(([cat,label]) => {
      const has = (cat==="ram"||cat==="ssd"||cat==="hdd"||cat==="fan") ? (qty(cat)>0) : !!get(cat);
      const count = (cat==="ram"||cat==="ssd"||cat==="hdd"||cat==="fan") ? `x${qty(cat)}` : "";
      return `
        <div class="bm-viz-slot">
          <b>${label}</b>
          ${badge(has, has ? ("Selected " + count) : "Empty")}
        </div>
      `;
    }).join("");

    box.innerHTML = `
      <div class="bm-viz-title">Build Snapshot</div>
      <div class="bm-viz-grid">${cards}</div>
    `;
  }

  // Call visualizer whenever build changes
  function wrap(fn){
    const old = window[fn];
    if(typeof old !== "function") return;
    window[fn] = function(){
      const r = old.apply(this, arguments);
      setTimeout(renderVisualizer, 50);
      return r;
    };
  }
  ["updateBuildDisplay","addToBuild","removeItem","clearAllBuild"].forEach(wrap);

  // ----- Fix-it buttons -----
  function setSelectedByCategory(category, product){
    if(!product) return false;
    const cat = low(category);
    const items = Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
    const existingIdx = items.findIndex(i => low(i.category)===cat);
    const oldPrice = existingIdx>=0 ? num(items[existingIdx].price) * num(items[existingIdx].qty||1) : 0;

    const meta = (product.meta && typeof product.meta==="object") ? product.meta : {};
    const ds = {
      id: String(product.id||""),
      name: String(product.name||""),
      category: String(product.category||""),
      price: String(product.price||"0"),
      specs: String(product.specs||""),
      perf: String(meta.perf||""),
      socket: String(meta.socket||""),
      tdp: String(meta.tdp||""),
      length: String(meta.length||""),
      maxGpuLength: String(meta.gpuMaxLength||meta.maxGpuLength||""),
      wattage: String(meta.wattage||meta.watts||""),
      formFactor: Array.isArray(meta.formFactor) ? meta.formFactor.join(",") : String(meta.formFactor||""),
      ddr: String(meta.ddr||"")
    };
    const item = { name: product.name, price: num(product.price), category: cat, dataset: ds, qty: 1 };

    if(existingIdx>=0) items[existingIdx] = item;
    else items.push(item);

    // update totals
    let total = 0;
    items.forEach(it => total += num(it.price) * num(it.qty||1));
    window.selectedItems = items;
    if(typeof selectedItems !== "undefined") selectedItems = items;
    window.currentTotal = total;
    if(typeof currentTotal !== "undefined") currentTotal = total;

    updateBuildDisplay();
    syncSelectedCardsUI();
    checkCompatibility();
    updateFPS();
    return true;
  }

  function socketOf(p){
    const s = p?.meta?.socket || "";
    const m = String(p?.specs||"").toUpperCase().match(/(AM\d|LGA\d+)/);
    return String(s || (m?m[1]:"")).toUpperCase();
  }
  function ddrOf(p){
    const d = p?.meta?.ddr || "";
    const s = String(p?.specs||"").toUpperCase();
    if(s.includes("DDR5")) return "DDR5";
    if(s.includes("DDR4")) return "DDR4";
    return String(d).toUpperCase();
  }
  function gpuLen(p){ return num(p?.meta?.length || 0); }
  function caseMax(p){ return num(p?.meta?.gpuMaxLength || 0); }
  function watt(p){ return num(p?.meta?.wattage || p?.meta?.watts || 0); }

  function recommendPSU(cpu, gpu){
    const base = num(cpu?.meta?.tdp) + num(gpu?.meta?.tdp) + 120;
    const need = Math.ceil(base*1.35);
    const steps=[450,500,550,600,650,700,750,800,850,900,1000,1200,1300,1500];
    return steps.find(x=>need<=x) || 1600;
  }

  window.bmFixCompatibility = function(kind){
    const all = getAll();
    const items = Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
    const cpu = items.find(i=>low(i.category)==="cpu") ? findByName(items.find(i=>low(i.category)==="cpu").name) : null;
    const gpu = items.find(i=>low(i.category)==="gpu") ? findByName(items.find(i=>low(i.category)==="gpu").name) : null;
    const mb  = items.find(i=>low(i.category)==="motherboard") ? findByName(items.find(i=>low(i.category)==="motherboard").name) : null;
    const ram = items.find(i=>low(i.category)==="ram") ? findByName(items.find(i=>low(i.category)==="ram").name) : null;
    const pcCase = items.find(i=>low(i.category)==="case") ? findByName(items.find(i=>low(i.category)==="case").name) : null;
    const psu = items.find(i=>low(i.category)==="psu") ? findByName(items.find(i=>low(i.category)==="psu").name) : null;

    if(kind==="mbSocket" && cpu){
      const sock = socketOf(cpu);
      const cand = all.filter(p=>low(p.category)==="motherboard" && socketOf(p)===sock).sort((a,b)=>num(a.price)-num(b.price))[0];
      if(cand && setSelectedByCategory("motherboard", cand)) return showToast("✅ Motherboard fixed");
    }

    if(kind==="ramDDR" && mb){
      const d = ddrOf(mb);
      const cand = all.filter(p=>low(p.category)==="ram" && (!d || ddrOf(p)===d)).sort((a,b)=>num(a.price)-num(b.price))[0];
      if(cand && setSelectedByCategory("ram", cand)) return showToast("✅ RAM fixed");
    }

    if(kind==="psuWatt" && (cpu || gpu)){
      const rec = recommendPSU(cpu, gpu);
      const cand = all.filter(p=>low(p.category)==="psu" && watt(p)>=rec).sort((a,b)=>num(a.price)-num(b.price))[0];
      if(cand && setSelectedByCategory("psu", cand)) return showToast("✅ PSU fixed");
    }

    if(kind==="caseGpu" && gpu){
      const gl = gpuLen(gpu);
      const cand = all.filter(p=>low(p.category)==="case" && caseMax(p)>=gl).sort((a,b)=>num(a.price)-num(b.price))[0];
      if(cand && setSelectedByCategory("case", cand)) return showToast("✅ Case fixed");
    }

    showToast("No compatible replacement found.");
  };

  // Hook into compatibility panel renderer by wrapping checkCompatibility() output list if it exists
  const _oldCheck = window.checkCompatibility;
  window.checkCompatibility = function(){
    const r = _oldCheck ? _oldCheck() : undefined;
    try{
      const list = document.getElementById("compatibilityList");
      if(!list) return r;

      // Add fix buttons if certain phrases exist
      Array.from(list.children).forEach((row) => {
        const t = row.textContent || "";
        if(t.toLowerCase().includes("socket mismatch") && !row.querySelector(".bm-fix-btn")){
          row.insertAdjacentHTML("beforeend", ` <button class="bm-fix-btn" type="button" onclick="bmFixCompatibility('mbSocket')">Fix</button>`);
        }
        if(t.toLowerCase().includes("ram type mismatch") && !row.querySelector(".bm-fix-btn")){
          row.insertAdjacentHTML("beforeend", ` <button class="bm-fix-btn" type="button" onclick="bmFixCompatibility('ramDDR')">Fix</button>`);
        }
        if(t.toLowerCase().includes("psu") && t.toLowerCase().includes("too") && !row.querySelector(".bm-fix-btn")){
          row.insertAdjacentHTML("beforeend", ` <button class="bm-fix-btn" type="button" onclick="bmFixCompatibility('psuWatt')">Fix</button>`);
        }
        if(t.toLowerCase().includes("gpu too long") && !row.querySelector(".bm-fix-btn")){
          row.insertAdjacentHTML("beforeend", ` <button class="bm-fix-btn" type="button" onclick="bmFixCompatibility('caseGpu')">Fix</button>`);
        }
      });
    }catch(e){}
    return r;
  };

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      loadSharedFromQuery();
      renderVisualizer();
    }, 120);
  });
})();

/* ===== BUILDMATRIX OVERVIEW V3 =====
   Cleaner, more professional overview:
   - grouped by category with headers
   - qty controls inline for multi-qty categories
   - sticky summary card (total + actions)
*/
(function(){
  const MULTI = new Set(["ram","ssd","hdd","fan","monitor"]);
  const low = (s)=>String(s||"").toLowerCase();
  const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };
  const esc = (s)=> (typeof escapeHtml==="function") ? escapeHtml(String(s||"")) : String(s||"");

  function items(){
    return Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
  }
  function total(){
    return Number(window.currentTotal ?? (typeof currentTotal!=="undefined" ? currentTotal : 0));
  }
  function label(cat){
    const m={cpu:"CPU",gpu:"GPU",motherboard:"Motherboard",ram:"RAM",ssd:"SSD",hdd:"HDD",psu:"PSU",case:"Case",fan:"Fans",monitor:"Monitors",keyboard:"Keyboards",mouse:"Mice"};
    return m[low(cat)] || String(cat||"").toUpperCase();
  }

  const ORDER = ["cpu","gpu","motherboard","ram","ssd","hdd","psu","case","fan","monitor","keyboard","mouse"];

  function row(it, idx){
    const price = num(it.price);
    const qty = num(it.qty) || 1;
    const sub = price * qty;
    const cat = low(it.category);

    const qtyControls = MULTI.has(cat) ? `
      <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
        <button class="bm-qty-btn" type="button" onclick="decreaseQty(${idx}); showOverviewView();" aria-label="Decrease">−</button>
        <span class="bm-qty-chip">Qty: ${qty}</span>
        <button class="bm-qty-btn" type="button" onclick="increaseQty(${idx}); showOverviewView();" aria-label="Increase">+</button>
      </div>` : `<span class="bm-qty-chip">Qty: 1</span>`;

    return `
      <div class="bm-stat" style="border-radius:16px;">
        <div style="min-width:0;">
          <div style="font-weight:900;">${esc(it.name)}</div>
          ${it.dataset && it.dataset.specs ? `<div style="opacity:.78; font-size:.92rem; margin-top:4px;">${esc(it.dataset.specs)}</div>` : ""}
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <span class="bm-pill">${label(cat)}</span>
            <span class="bm-pill">Unit: ₱${price.toLocaleString()}</span>
            <span class="bm-pill">Subtotal: ₱${sub.toLocaleString()}</span>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px; align-items:flex-end;">
          ${qtyControls}
          <button class="ov-link" type="button" onclick="filterCategory('${esc(cat)}')">Change</button>
          <button class="ov-link" type="button" onclick="bmOverviewRemove('${esc(it.name).replaceAll("'","&#39;")}'); showOverviewView();">Remove</button>
        </div>
      </div>
    `;
  }

  window.showOverviewView = function(){
    const main = document.getElementById("mainContent");
    if(!main) return;

    const list = items();
    const tot = total();

    if(!list.length){
      main.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <div>
            <h2 style="margin:0;">Overview</h2>
            <div style="opacity:.8; margin-top:6px;">No parts selected yet.</div>
          </div>
          <button class="dark-mode-toggle" type="button" onclick="showAllProducts()"><i class="fas fa-wrench"></i> Back</button>
        </div>`;
      return;
    }

    // group by category in ORDER
    const groups = {};
    list.forEach((it, idx) => {
      const c = low(it.category);
      if(!groups[c]) groups[c] = [];
      groups[c].push({it, idx});
    });

    const sections = ORDER.filter(c => groups[c]?.length).map(c => {
      const rows = groups[c].map(x => row(x.it, x.idx)).join("");
      return `
        <section style="margin-bottom:14px;">
          <h3 style="margin: 0 0 10px;">${label(c)}</h3>
          <div style="display:flex; flex-direction:column; gap:10px;">${rows}</div>
        </section>
      `;
    }).join("");

    main.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom: 12px;">
        <div>
          <h2 style="margin:0;">Overview</h2>
          <div style="opacity:.78; margin-top:6px;">Review your build, adjust quantities, then save/share.</div>
        </div>
        <div class="bm-top-actions">
          <button class="dark-mode-toggle" type="button" onclick="showAllProducts()"><i class="fas fa-wrench"></i><span class="bm-btn-label">Back to Builder</span></button>
          <button class="save-build-btn" type="button" onclick="saveCurrentBuild()"><i class="fas fa-save"></i><span class="bm-btn-label">Save Build</span></button>
          <button class="pdf-btn" type="button" onclick="downloadPDF()"><i class="fas fa-file-pdf"></i><span class="bm-btn-label">Save PDF</span></button>
          <button class="dark-mode-toggle" type="button" onclick="copyShareLink()"><i class="fas fa-link"></i><span class="bm-btn-label">Share</span></button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1.7fr 1fr; gap:14px;">
        <div>${sections}</div>

        <aside class="ov-card" style="position:sticky; top: 16px; height: fit-content;">
          <h3 style="margin:0 0 10px;">Summary</h3>
          <div class="bm-stat" style="border-radius:16px;">
            <span style="font-weight:900;">Total</span>
            <span style="font-weight:900;">₱${tot.toLocaleString()}</span>
          </div>
          <div style="opacity:.75; margin-top:10px; font-size:.9rem;">
            Tip: Use +/− for RAM, Storage, Fans, and Monitors.
          </div>
          <button class="clear-all-btn" type="button" style="margin-top:12px; width:100%;" onclick="clearAllBuild(); showOverviewView();">
            Clear All
          </button>
        </aside>
      </div>
    `;

    const sd = document.getElementById("selectionDetail");
    if(sd) sd.innerHTML = `<h3>OVERVIEW</h3><p class="sd-note">Everything is editable here. Use Back to Builder when done.</p>`;
  };
})();

/* DISABLE_FPS_FUNCTION */
window.updateFPS = function(){
  const panel = document.getElementById("fpsPanel");
  if(panel) panel.style.display = "none";
  const content = document.getElementById("fpsContent");
  if(content) content.innerHTML = "";
};


/* COMPARE_HARD_FIX */
(function(){
  const low = (s)=>String(s||"").toLowerCase();
  function getAll(){
    if (Array.isArray(window.PRODUCTS)) return window.PRODUCTS;
    if (Array.isArray(window.products)) return window.products;
    if (window.products && typeof window.products === "object") return Object.values(window.products).flat().filter(Boolean);
    return [];
  }
  function listByType(type){
    const t = low(type);
    return getAll().filter(p => low(p.category) === t).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }

  window.populateCompareSelects = function(){
    const type = document.getElementById("bmCompareType")?.value || "cpu";
    const a = document.getElementById("bmCompareA");
    const b = document.getElementById("bmCompareB");
    if(!a || !b) return;
    const list = listByType(type);
    a.innerHTML = list.map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
    b.innerHTML = list.map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
    if(list.length){
      a.value = list[0].id;
      b.value = list[Math.min(1,list.length-1)].id;
    }
  };

  window.openCompareModal = function(){
    const m = document.getElementById("compareModal");
    if(!m) return;
    m.style.display = "flex";
    window.populateCompareSelects();
    const t = document.getElementById("bmCompareType");
    if(t && !t.dataset.bound){
      t.addEventListener("change", window.populateCompareSelects);
      t.dataset.bound = "1";
    }
  };

  window.closeCompareModal = function(){
    const m = document.getElementById("compareModal");
    if(m) m.style.display = "none";
  };
})();

/* QTY_SYSTEM_V3 (name-based, replaces buggy injection) */
(function(){
  const MULTI = new Set(["ram","ssd","hdd","fan","monitor"]);
  const SINGLE = new Set(["cpu","gpu","motherboard","psu","case","keyboard","mouse"]);
  const low = (s)=>String(s||"").toLowerCase();
  const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };

  function findItem(name){ return selectedItems.find(i=>i.name===name); }
  function recomputeTotal(){
    currentTotal = selectedItems.reduce((s,it)=>s + num(it.price)*num(it.qty||1), 0);
  }

  window.increaseQtyByName = function(name){
    const it = findItem(name);
    if(!it) return;
    if(!MULTI.has(low(it.category))) return;
    it.qty = (num(it.qty)||1) + 1;
    recomputeTotal();
    updateBuildDisplay(); checkCompatibility(); 
  };

  window.decreaseQtyByName = function(name){
    const it = findItem(name);
    if(!it) return;
    if(!MULTI.has(low(it.category))) return;
    it.qty = (num(it.qty)||1) - 1;
    if(it.qty <= 0){
      selectedItems = selectedItems.filter(x=>x.name!==name);
      document.querySelectorAll(".product-card").forEach((card)=>{
        if(card.dataset.name===name){
          card.classList.remove("selected");
          const btn = card.querySelector(".add-to-build");
          if(btn) btn.textContent = "+ Add to Build";
        }
      });
    }
    recomputeTotal();
    updateBuildDisplay(); checkCompatibility();
  };

  // Override removeItem(name) => for MULTI decrement, else remove
  window.removeItem = function(itemName){
    const it = findItem(itemName);
    if(!it) return;
    if(MULTI.has(low(it.category)) && (num(it.qty)||1) > 1){
      it.qty = (num(it.qty)||1) - 1;
      recomputeTotal();
      updateBuildDisplay(); checkCompatibility();
      return;
    }
    selectedItems = selectedItems.filter((i)=>i.name!==itemName);
    document.querySelectorAll(".product-card").forEach((card)=>{
      if(card.dataset.name===itemName){
        card.classList.remove("selected");
        const btn = card.querySelector(".add-to-build");
        if(btn) btn.textContent = "+ Add to Build";
      }
    });
    recomputeTotal();
    updateBuildDisplay(); checkCompatibility();
  };

  // Override addToBuild(button) for MULTI increment instead of toggle-off
  const _oldAdd = window.addToBuild;
  window.addToBuild = function(button){
    const card = button?.closest?.(".product-card");
    if(!card) return _oldAdd(button);

    const price = parseInt(card.dataset.price||"0",10);
    const name = card.dataset.name || "Component";
    const category = low(card.dataset.category || "other");

    // SINGLE categories: replace existing in same category if different
    if(SINGLE.has(category) && !card.classList.contains("selected")){
      const existing = selectedItems.find((i)=>low(i.category)===category);
      if(existing && existing.name !== name){
        selectedItems = selectedItems.filter(i=>low(i.category)!==category);
        document.querySelectorAll(".product-card").forEach((c)=>{
          if(c.dataset.name===existing.name){
            c.classList.remove("selected");
            const b = c.querySelector(".add-to-build");
            if(b) b.textContent = "+ Add to Build";
          }
        });
      }
    }

    // MULTI categories: if already selected, increment qty (do not remove)
    if(MULTI.has(category) && card.classList.contains("selected")){
      const it = findItem(name);
      if(it){
        it.qty = (num(it.qty)||1) + 1;
        recomputeTotal();
        updateBuildDisplay(); checkCompatibility();
        showToast(`Qty: ${it.qty}`);
        return;
      }
    }

    // Normal add (same as original) but ensure qty=1 for new items
    if(card.classList.contains("selected")){
      // for MULTI, don't toggle off; use removeItem instead
      if(MULTI.has(category)){
        window.decreaseQtyByName(name);
        return;
      }
      card.classList.remove("selected");
      selectedItems = selectedItems.filter(i=>i.name!==name);
      button.textContent = "+ Add to Build";
    } else {
      card.classList.add("selected");
      const datasetCopy = { ...card.dataset };
      selectedItems.push({ name, price, category, dataset: datasetCopy, qty: 1 });
      button.textContent = "✓ Added";
    }

    recomputeTotal();
    updateBuildDisplay(); checkCompatibility();
  };

  // Override updateBuildDisplay to render correct layout with qty controls
  window.updateBuildDisplay = function(){
    const total = document.getElementById("totalPrice");
    if(total) total.textContent = "₱" + Number(currentTotal||0).toLocaleString();

    const selectedParts = document.getElementById("selectedParts");
    const clearBtn = document.getElementById("clearAllBtn");
    if(!selectedParts || !clearBtn) return;

    if(selectedItems.length){
      let html = '<h3 style="margin-bottom: 15px; color: var(--text);">Selected Components:</h3>';
      selectedItems.forEach((item)=>{
        const safeName = (typeof escapeHtml==="function") ? escapeHtml(item.name) : item.name;
        const safeOnclick = item.name.replace(/'/g, "\\'");
        const qty = num(item.qty)||1;
        const sub = qty * num(item.price);
        const cat = low(item.category);

        const qtyUI = MULTI.has(cat) ? `
          <div class="selected-item-qtyrow">
            <div class="selected-item-qtymeta">
              <span class="bm-qty-chip">Qty: ${qty}</span>
              <span class="bm-qty-chip subtotal">Subtotal: ₱${sub.toLocaleString()}</span>
            </div>
            <div class="selected-item-qtyactions">
              <button class="bm-qty-btn" type="button" onclick="decreaseQtyByName('${safeOnclick}')" aria-label="Decrease">−</button>
              <button class="bm-qty-btn" type="button" onclick="increaseQtyByName('${safeOnclick}')" aria-label="Increase">+</button>
            </div>
          </div>` : ``;

        html += `
          <div class="selected-item">
            <div class="selected-item-left">
              <div class="selected-item-name">${safeName}</div>
            </div>
            <div class="selected-item-right">
              <div class="selected-item-price-row">
                <div class="selected-item-price">₱${num(item.price).toLocaleString()}</div>
                <span class="selected-item-remove" onclick="removeItem('${safeOnclick}')" title="Remove">
                  <i class="fas fa-times"></i>
                </span>
              </div>
              ${qtyUI}
            </div>
          </div>
        `;
      });
      selectedParts.innerHTML = html;
      clearBtn.style.display = "block";
    } else {
      selectedParts.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <i class="fas fa-arrow-left" style="font-size: 3rem; margin-bottom: 10px;"></i>
          <p>No items selected</p>
          <small>Click "Add to Build" on any product</small>
        </div>
      `;
      clearBtn.style.display = "none";
    }
  };

})();

/* AUTOBUILD_RAM_STICKS */
(function(){
  // Wrap generateAutoBuild to set RAM qty depending on budget tier (4 sticks on high-end)
  const _gen = window.generateAutoBuild;
  if(typeof _gen !== "function") return;

  window.generateAutoBuild = async function(){
    await _gen();
    try{
      // lastAutoBuild is internal; if exists in scope it will be used already. We can't access directly,
      // so we adjust the UI suggestion text only is hard. Instead, when applying build, we'll set RAM qty based on budget.
    }catch(e){}
  };

  // Wrap applyAutoBuild to set RAM qty = 4 on high budgets
  const _apply = window.applyAutoBuild;
  window.applyAutoBuild = function(){
    // read budget from modal
    const budget = Number(document.getElementById("bmBudget")?.value || 0);
    _apply();
    try{
      const high = budget >= 100000;
      if(!high) return;
      const items = Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []);
      const ram = items.find(i => String(i.category).toLowerCase() === "ram");
      if(ram){
        ram.qty = Math.max(4, Number(ram.qty||1));
        // recompute total
        window.currentTotal = items.reduce((s,it)=>s + Number(it.price||0)*Number(it.qty||1),0);
        if(typeof currentTotal !== "undefined") currentTotal = window.currentTotal;
        updateBuildDisplay();
        showToast("✅ High-end RAM set to 4 sticks");
      }
    }catch(e){}
  };
})();

/* COMPARE_TIMEOUT_FIX */
(function(){
  const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };
  function withTimeout(promise, ms){
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      promise.then((v)=>{ clearTimeout(t); resolve(v); }).catch(()=>{ clearTimeout(t); resolve(null); });
    });
  }

  // Wrap runCompare if it exists
  const oldRun = window.runCompare;
  if(typeof oldRun === "function"){
    window.runCompare = async function(){
      const out = document.getElementById("bmCompareResult");
      try{
        // run original until it sets Loading state, then we override core logic safely if it fails
        // We'll just replace it completely using the selects.
        const type = document.getElementById("bmCompareType")?.value || "cpu";
        const ida = document.getElementById("bmCompareA")?.value;
        const idb = document.getElementById("bmCompareB")?.value;
        if(!out) return;

        const all = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
        const list = all.filter(p=>String(p.category).toLowerCase()===String(type).toLowerCase());
        const A = list.find(p=>p.id===ida);
        const B = list.find(p=>p.id===idb);

        if(!A || !B){
          out.innerHTML = `<div style="opacity:.8;">Pick two parts to compare.</div>`;
          return;
        }

        out.innerHTML = `<div style="opacity:.8;">Loading PassMark…</div>`;

        const fetchBench = async (p) => {
          if(typeof window.bmGetRealBenchmark !== "function") return null;
          return await withTimeout(window.bmGetRealBenchmark({ name: p.name, category: p.category }), 4500);
        };

        const [pa, pb] = await Promise.all([fetchBench(A), fetchBench(B)]);
        const sa = pa && pa.score ? num(pa.score) : 0;
        const sb = pb && pb.score ? num(pb.score) : 0;

        const value = (score, price) => score && price ? Math.round((score/price)*1000) : 0;
        const va = value(sa, num(A.price));
        const vb = value(sb, num(B.price));

        const label = (String(type).toLowerCase()==="cpu") ? "PassMark CPU Mark" : "PassMark G3D Mark";

        const card = (p, s, v, src) => `
          <div style="border:1px solid rgba(0,0,0,0.10); border-radius:18px; padding:14px; background: rgba(0,0,0,0.02);">
            <div style="font-weight:900; font-size:1.05rem;">${p.name}</div>
            <div style="opacity:.8; margin-top:4px;">${p.specs || ""}</div>
            <div class="bm-stat" style="margin-top:12px;"><span><b>Price</b></span><span>₱${num(p.price).toLocaleString()}</span></div>
            <div class="bm-stat"><span><b>${label}</b></span><span>${s ? num(s).toLocaleString() : "Unavailable"}</span></div>
            <div class="bm-stat"><span><b>Value Score</b></span><span>${v ? v : "—"}</span></div>
            ${src?.url ? `<div style="margin-top:10px;"><a href="${src.url}" target="_blank" style="opacity:.85;">View source</a></div>` : ""}
          </div>
        `;

        const winBench = (sa && sb) ? (sa>sb ? "A" : (sb>sa ? "B" : "Tie")) : "—";
        const winValue = (va && vb) ? (va>vb ? "A" : (vb>va ? "B" : "Tie")) : "—";

        out.innerHTML = `
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
            <span class="bm-pill">Winner (Benchmark): <b style="margin-left:6px;">${winBench}</b></span>
            <span class="bm-pill">Winner (Value): <b style="margin-left:6px;">${winValue}</b></span>
          </div>
          <div class="bm-compare-grid">
            ${card(A, sa, va, pa)}
            ${card(B, sb, vb, pb)}
          </div>
          <div style="opacity:.7; font-size:.9rem; margin-top:10px;">
            If PassMark is unavailable for a part, the comparison still shows price + specs.
          </div>
        `;
      }catch(e){
        if(out) out.innerHTML = `<div style="opacity:.85;">Comparison failed. Try again.</div>`;
      }
    };
  }
})();

/* PCWORX_CLIENT_PRICE_APPLY
   Loads prices from /api/pcworx/prices and updates window.PRODUCTS in-memory.
   Matches by normalized name (best-effort) and takes the lowest matching PCWORX price.
*/
(function(){
  function norm(s){
    return String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  }

  function bestPriceForProduct(prodName, priceMap){
    const n = norm(prodName);
    if (priceMap[n]) return priceMap[n];

    // fallback: token containment (choose closest/lowest)
    const tokens = n.split(" ").filter(Boolean);
    let best = null;

    for (const [k, price] of Object.entries(priceMap)) {
      if (!k) continue;
      let ok = true;
      for (const t of tokens) {
        // skip very short tokens to avoid false matches
        if (t.length <= 2) continue;
        if (!k.includes(t)) { ok = false; break; }
      }
      if (ok) {
        if (best === null || price < best) best = price;
      }
    }
    return best;
  }

  async function applyPCWORXPrices(){
    try{
      const res = await fetch("/api/pcworx/prices");
      if(!res.ok) return;
      const data = await res.json();
      const maps = data?.result;
      if(!maps) return;

      if (Array.isArray(window.PRODUCTS)) {
        window.PRODUCTS.forEach(p => {
          const cat = String(p.category||"").toLowerCase();
          const map = maps[cat];
          if(!map) return;
          const price = bestPriceForProduct(p.name, map);
          if (price && Number.isFinite(Number(price)) && Number(price) > 0) {
            p.price = Number(price);
          }
        });
      }

      // refresh UI if currently showing a category grid
      try { if (typeof filterCategory === "function") filterCategory(UI?.activeCategory || "cpu"); } catch(e){}
      try { if (typeof showToast === "function") showToast("✅ Prices updated from PCWORX"); } catch(e){}
    }catch(e){}
  }

  document.addEventListener("DOMContentLoaded", () => {
    // do not block page load
    setTimeout(applyPCWORXPrices, 500);
  });
})();


/* PCWORX_GPU_MODEL_MATCH_V2
   Improves matching so more GPUs get prices:
   - extracts model keys like "RTX 4070 TI SUPER", "RX 7900 XTX"
   - scans PCWORX title-map keys for that model and uses the lowest price found
   - only overwrites price if current price is 0 or missing
*/
(function(){
  function norm(s){
    return String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  }
  function extractModelKey(name){
    const t = String(name||"").toUpperCase();
    let m = t.match(/\bRTX\s*(\d{3,4})\s*(TI)?\s*(SUPER)?\b/);
    if(m) return ("RTX " + m[1] + (m[2] ? " TI" : "") + (m[3] ? " SUPER" : "")).trim();
    m = t.match(/\bGTX\s*(\d{3,4})\s*(TI)?\b/);
    if(m) return ("GTX " + m[1] + (m[2] ? " TI" : "")).trim();
    m = t.match(/\bRX\s*(\d{4,5})\s*(XTX|XT|GRE)?\b/);
    if(m) return ("RX " + m[1] + (m[2] ? " " + m[2] : "")).trim();
    return "";
  }
  function minPriceForModel(modelKey, priceMap){
    if(!modelKey || !priceMap) return 0;
    const mk = norm(modelKey);
    let best = 0;
    for(const [k,v] of Object.entries(priceMap)){
      const kk = String(k||"");
      if(!kk) continue;
      // keys from server are normalized full titles
      if(kk.includes(mk)){
        const p = Number(v);
        if(Number.isFinite(p) && p>0){
          if(best===0 || p<best) best=p;
        }
      }
    }
    return best;
  }

  async function applyBetterPrices(){
    try{
      const res = await fetch("/api/pcworx/prices");
      if(!res.ok) return;
      const data = await res.json();
      const maps = data?.result;
      if(!maps || !Array.isArray(window.PRODUCTS)) return;

      // First pass: existing exact matcher already set many prices; here we fill gaps
      window.PRODUCTS.forEach(p => {
        const cat = String(p.category||"").toLowerCase();
        if(!(cat==="gpu" || cat==="cpu")) return;
        if(Number(p.price||0) > 0) return;

        const model = extractModelKey(p.name);
        const best = minPriceForModel(model, maps[cat]);
        if(best>0) p.price = best;
      });

      // refresh current view if possible
      try { if (typeof filterCategory === "function") filterCategory((window.UI && window.UI.activeCategory) ? window.UI.activeCategory : "cpu"); } catch(e){}
      try { showToast("✅ GPU/CPU prices improved (model match)"); } catch(e){}
    }catch(e){}
  }

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(applyBetterPrices, 1200);
  });
})();

/* BM_BUDGET_BREAKDOWN_SUGGEST_FULL */
(function(){
  const low = (s)=>String(s||"").toLowerCase();
  const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };

  function getAll(){
    if (Array.isArray(window.PRODUCTS)) return window.PRODUCTS;
    if (Array.isArray(window.products)) return window.products;
    if (window.products && typeof window.products === "object") return Object.values(window.products).flat().filter(Boolean);
    return [];
  }
  function byName(name){ return getAll().find(p=>String(p.name||"")===String(name||"")) || null; }
  function getItems(){ return Array.isArray(window.selectedItems) ? window.selectedItems : (typeof selectedItems!=="undefined" ? selectedItems : []); }
  function getTotal(){ return Number(window.currentTotal ?? (typeof currentTotal!=="undefined" ? currentTotal : 0)); }

  function saveBudget(v){ try{ localStorage.setItem("bm_budget_main", String(v)); }catch(e){} }
  function loadBudget(){ try{ const v=Number(localStorage.getItem("bm_budget_main")||50000); return Number.isFinite(v)?v:50000; }catch(e){ return 50000; } }

  function socketOf(p){
    const s = (p && p.meta && p.meta.socket) ? p.meta.socket : "";
    const m = String(p?.specs||"").toUpperCase().match(/(AM\d|LGA\d+)/);
    return String(s || (m?m[1]:"")).toUpperCase();
  }
  function ddrOf(p){
    const d = (p && p.meta && p.meta.ddr) ? p.meta.ddr : "";
    const s = String(p?.specs||"").toUpperCase();
    if(s.includes("DDR5")) return "DDR5";
    if(s.includes("DDR4")) return "DDR4";
    return String(d).toUpperCase();
  }
  function wattOf(p){ return num(p?.meta?.wattage || p?.meta?.watts || 0); }
  function tdpOf(p){ return num(p?.meta?.tdp || 0); }
  function gpuLen(p){ return num(p?.meta?.length || 0); }
  function caseMax(p){ return num(p?.meta?.gpuMaxLength || 0); }
  function recommendPSU(cpu, gpu){
    const base = tdpOf(cpu) + tdpOf(gpu) + 120;
    const need = Math.ceil(base*1.35);
    const steps=[450,500,550,600,650,700,750,800,850,900,1000,1200,1300,1500];
    for(const s of steps){ if(need<=s) return s; }
    return 1600;
  }

  function selectedByCat(cat){ return getItems().find(i => low(i.category)===low(cat)) || null; }

  function isCompatibleCandidate(cat, cand){
    const catL = low(cat);
    const cpu = selectedByCat("cpu") ? byName(selectedByCat("cpu").name) : null;
    const gpu = selectedByCat("gpu") ? byName(selectedByCat("gpu").name) : null;
    const mb  = selectedByCat("motherboard") ? byName(selectedByCat("motherboard").name) : null;
    const ram = selectedByCat("ram") ? byName(selectedByCat("ram").name) : null;
    const pcCase = selectedByCat("case") ? byName(selectedByCat("case").name) : null;

    if(catL==="cpu" && mb){
      const s1 = socketOf(cand), s2 = socketOf(mb);
      if(s1 && s2 && s1!==s2) return false;
    }
    if(catL==="motherboard" && cpu){
      const s1 = socketOf(cand), s2 = socketOf(cpu);
      if(s1 && s2 && s1!==s2) return false;
      if(ram){
        const d1=ddrOf(cand), d2=ddrOf(ram);
        if(d1 && d2 && d1!==d2) return false;
      }
    }
    if(catL==="ram" && mb){
      const d1=ddrOf(cand), d2=ddrOf(mb);
      if(d1 && d2 && d1!==d2) return false;
    }
    if(catL==="gpu" && pcCase){
      const gl=gpuLen(cand), mx=caseMax(pcCase);
      if(gl && mx && gl>mx) return false;
    }
    if(catL==="case" && gpu){
      const mx=caseMax(cand), gl=gpuLen(gpu);
      if(mx && gl && gl>mx) return false;
    }
    if(catL==="psu" && (cpu||gpu)){
      const rec=recommendPSU(cpu,gpu);
      const w=wattOf(cand);
      if(w && w < rec) return false;
    }
    return true;
  }

  function buildCheaperSuggestions(){
    const items = getItems();
    if(!items.length) return [];
    const target = items.slice().sort((a,b)=> (num(b.price)*num(b.qty||1)) - (num(a.price)*num(a.qty||1)))[0];
    if(!target) return [];
    const cat = low(target.category);
    const currentCost = num(target.price) * num(target.qty||1);

    const all = getAll().filter(p=>low(p.category)===cat && num(p.price)>0 && num(p.price) < num(target.price));
    const candidates = all.filter(p=>isCompatibleCandidate(cat,p)).sort((a,b)=>num(a.price)-num(b.price)).slice(0,8)
      .map(p=>({category:cat,name:p.name,price:num(p.price),saves:currentCost-num(p.price)}));
    candidates.sort((a,b)=>b.saves-a.saves);
    return candidates.slice(0,3);
  }

  window.bmSwapSelected = function(category, newName){
    const cat = low(category);
    const items = getItems();
    const existingIdx = items.findIndex(i=>low(i.category)===cat);
    const prod = byName(newName);
    if(!prod) return;

    if(existingIdx>=0){
      items[existingIdx].name = prod.name;
      items[existingIdx].price = num(prod.price);
      items[existingIdx].dataset = items[existingIdx].dataset || {};
      items[existingIdx].dataset.name = prod.name;
      items[existingIdx].dataset.price = String(prod.price);
      items[existingIdx].dataset.specs = String(prod.specs||"");
      items[existingIdx].qty = 1;
    }else{
      items.push({ name: prod.name, price: num(prod.price), category: cat, dataset: { name: prod.name, price: String(prod.price), category: cat, specs: String(prod.specs||"") }, qty: 1 });
    }
    const total = items.reduce((s,it)=>s + num(it.price)*num(it.qty||1),0);
    window.currentTotal = total;
    if(typeof currentTotal!=="undefined") currentTotal = total;
    window.selectedItems = items;
    if(typeof selectedItems!=="undefined") selectedItems = items;

    try{ updateBuildDisplay(); }catch(e){}
    try{ syncSelectedCardsUI(); }catch(e){}
    try{ checkCompatibility(); }catch(e){}
    try{ showToast("✅ Swapped"); }catch(e){}
  };

  function updateBudgetUI(){
    const inp=document.getElementById("bmBudgetMain");
    const rem=document.getElementById("bmRemaining");
    if(!inp || !rem) return;

    const budget=num(inp.value || loadBudget());
    const total=getTotal();
    const remaining=budget-total;

    rem.textContent="₱"+Math.round(remaining).toLocaleString();
    rem.classList.toggle("negative", remaining<0);
    rem.classList.toggle("positive", remaining>=0);

    const box=document.getElementById("bmSuggestions");
    if(!box) return;
    if(remaining>=0){
      box.style.display="none";
      box.innerHTML="";
      return;
    }
    const sugg=buildCheaperSuggestions();
    box.style.display="block";
    box.innerHTML = `
      <div class="bm-suggest-card">
        <div class="bm-suggest-title">Over budget by ₱${Math.abs(Math.round(remaining)).toLocaleString()}</div>
        <div style="opacity:.8;">Try swapping a part:</div>
        ${sugg.map(x=>`
          <div class="bm-suggest-item">
            <div style="min-width:0;">
              <div style="font-weight:900;">${x.name}</div>
              <div style="opacity:.75;">₱${x.price.toLocaleString()} • saves ₱${Math.round(x.saves).toLocaleString()}</div>
            </div>
            <button class="save-build-btn" type="button" onclick="bmSwapSelected('${x.category}','${x.name.replaceAll("'","&#39;")}')">Swap</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  window.applyTemplate = function(kind){
    const b=document.getElementById("bmBudget");
    const p=document.getElementById("bmPurpose");
    const pref=document.getElementById("bmPreference");
    if(!b || !p || !pref) return;
    if(kind==="school"){ b.value=30000; p.value="school"; pref.value="value"; }
    if(kind==="gaming"){ b.value=50000; p.value="gaming"; pref.value="balanced"; }
    if(kind==="creator"){ b.value=80000; p.value="editing"; pref.value="cpu"; }
  };

  const oldAdd=window.addToBuild;
  if(typeof oldAdd==="function"){
    window.addToBuild=function(btn){
      const r=oldAdd(btn);
      try{ document.querySelector(".build-sidebar")?.scrollIntoView({behavior:"smooth", block:"start"}); }catch(e){}
      return r;
    };
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    const inp=document.getElementById("bmBudgetMain");
    if(inp){
      inp.value=loadBudget();
      inp.addEventListener("input", ()=>{ saveBudget(inp.value); updateBudgetUI(); });
    }
    setTimeout(updateBudgetUI, 250);
  });

  const oldUpdate=window.updateBuildDisplay;
  if(typeof oldUpdate==="function"){
    window.updateBuildDisplay=function(){
      const r=oldUpdate();
      updateBudgetUI();
      return r;
    };
  }

  const oldRun=window.runCompare;
  if(typeof oldRun==="function"){
    window.runCompare=async function(){
      const type=document.getElementById("bmCompareType")?.value || "cpu";
      const t=low(type);
      if(t==="cpu" || t==="gpu") return oldRun();

      const out=document.getElementById("bmCompareResult");
      if(!out) return;

      const ida=document.getElementById("bmCompareA")?.value;
      const idb=document.getElementById("bmCompareB")?.value;
      const list=getAll().filter(p=>low(p.category)===t);
      const A=list.find(p=>p.id===ida);
      const B=list.find(p=>p.id===idb);
      if(!A || !B){
        out.innerHTML=`<div style="opacity:.8;">Pick two parts to compare.</div>`;
        return;
      }

      const metaLine=(p)=>{
        const m=p.meta||{};
        if(t==="psu") return `Wattage: ${m.wattage||m.watts||"—"}`;
        if(t==="ram") return `Type: ${(String(p.specs||"").toUpperCase().includes("DDR5")?"DDR5":(String(p.specs||"").toUpperCase().includes("DDR4")?"DDR4":"—"))}`;
        if(t==="ssd") return `Type: ${(String(p.specs||"").toLowerCase().includes("nvme")?"NVMe":(String(p.specs||"").toLowerCase().includes("sata")?"SATA":"—"))}`;
        return "";
      };

      const card=(p)=>`
        <div style="border:1px solid rgba(0,0,0,0.10); border-radius:18px; padding:14px; background: rgba(0,0,0,0.02);">
          <div style="font-weight:900; font-size:1.05rem;">${p.name}</div>
          <div style="opacity:.8; margin-top:4px;">${p.specs||""}</div>
          <div class="bm-stat" style="margin-top:12px;"><span><b>Price</b></span><span>₱${num(p.price).toLocaleString()}</span></div>
          <div class="bm-stat"><span><b>Details</b></span><span>${metaLine(p)}</span></div>
        </div>
      `;
      out.innerHTML=`<div class="bm-compare-grid">${card(A)}${card(B)}</div>`;
    };
  }
})();