// BuildMatrix - Products UI (data-driven)
// Requires: products-data.js

function escapeAttr(str) {
  return String(str).replaceAll('"', "&quot;");
}

function camelToKebab(str) {
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

function getProductGroups() {
  const products = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];

  const isAMD = (p) => String(p.name || "").toUpperCase().startsWith("AMD ");
  const isIntel = (p) => String(p.name || "").toUpperCase().startsWith("INTEL ");

  return [
    { section: "cpu", title: '<i class="fab fa-amd"></i> AMD PROCESSORS', products: products.filter((p) => p.category === "cpu" && isAMD(p)) },
    { section: "cpu", title: '<i class="fab fa-intel"></i> INTEL PROCESSORS', products: products.filter((p) => p.category === "cpu" && isIntel(p)) },
    { section: "gpu", title: '<i class="fas fa-video"></i> GRAPHICS CARDS', products: products.filter((p) => p.category === "gpu") },
    { section: "ram", title: '<i class="fas fa-memory"></i> MEMORY (RAM)', products: products.filter((p) => p.category === "ram") },
    { section: "ssd", title: '<i class="fas fa-database"></i> SOLID STATE DRIVES', products: products.filter((p) => p.category === "ssd") },
    { section: "motherboard", title: '<i class="fas fa-microchip"></i> MOTHERBOARDS', products: products.filter((p) => p.category === "motherboard") },
    { section: "case", title: '<i class="fas fa-server"></i> PC CASES', products: products.filter((p) => p.category === "case") },
    { section: "psu", title: '<i class="fas fa-bolt"></i> POWER SUPPLIES', products: products.filter((p) => p.category === "psu") },
    { section: "keyboard", title: '<i class="fas fa-keyboard"></i> KEYBOARDS', products: products.filter((p) => p.category === "keyboard") },
    { section: "mouse", title: '<i class="fas fa-mouse"></i> MICE', products: products.filter((p) => p.category === "mouse") },
    { section: "fan", title: '<i class="fas fa-fan"></i> CASE FANS', products: products.filter((p) => p.category === "fan") },
    { section: "monitor", title: '<i class="fas fa-tv"></i> MONITORS', products: products.filter((p) => p.category === "monitor") },
    { section: "hdd", title: '<i class="fas fa-hdd"></i> HARD DRIVES', products: products.filter((p) => p.category === "hdd") },
    
  ].filter((g) => g.products.length > 0);
}

function formatPeso(n) {
  const num = Number(n) || 0;
  return "₱" + num.toLocaleString();
}

function tierLabel(tier) {
  const t = String(tier || "").toLowerCase();
  if (t === "highend" || t === "high-end" || t === "high") return { text: "HIGH-END", cls: "highend" };
  if (t === "performance" || t === "mid" || t === "midrange") return { text: "PERFORMANCE", cls: "performance" };
  return { text: "BUDGET", cls: "budget" };
}

function renderProductCard(p) {
  if (!p) return "";

  const meta = p.meta || {};
  const attrs = [
    `data-category="${escapeAttr(p.category)}"`,
    `data-price="${escapeAttr(p.price)}"`,
    `data-name="${escapeAttr(p.name)}"`,
    `data-tier="${escapeAttr(p.tier)}"`,
  ];

  // Inject compatibility attrs (socket/tdp/perf/etc)
  Object.keys(meta).forEach((k) => {
    const dataKey = "data-" + camelToKebab(k);
    attrs.push(`${dataKey}="${escapeAttr(meta[k])}"`);
  });

  const badge = tierLabel(p.tier);
  const rating = (typeof p.rating === "number" ? p.rating.toFixed(1) : null);
  const ratingCount = p.ratingCount ? ` (${p.ratingCount})` : "";

  return `
    <div class="product-card" ${attrs.join(" ")}>
      <img src="${escapeAttr(p.img || "assets/placeholder.svg")}" alt="${escapeAttr(p.name)}" onerror="this.src='assets/placeholder.svg'">
      <div class="product-info">
        <h3>${escapeAttr(p.name)}</h3>
        <p class="product-specs">${escapeAttr(p.specs || "")}</p>
        <div class="product-price">${formatPeso(p.price)}</div>
        <div class="product-badge ${badge.cls}">${badge.text}</div>
        ${rating ? `<div class="product-rating"><i class="fas fa-star"></i> ${rating}${ratingCount}</div>` : ""}
        <button class="add-to-build">+ Add to Build</button>
      </div>
    </div>
  `;
}

function renderSection(sectionName, titleHtml, products) {
  const cards = (products || []).map(renderProductCard).join("");
  return `
    <div class="product-section" data-section="${escapeAttr(sectionName)}">
      <h2 class="section-title">${titleHtml}</h2>
      <div class="products-grid">${cards}</div>
    </div>
  `;
}

// Export for builder.js to call
window.getProductGroups = getProductGroups;
window.renderSection = renderSection;
window.renderProductCard = renderProductCard;