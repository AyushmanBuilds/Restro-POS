// ===================== CUSTOMER QR ORDERING =====================
// Public page — no login. Reached by scanning a table's QR code:
// order.html?r=<restaurantId>&t=<tableName>
// Requires Firestore rules that allow public read on menu/settings and
// public create on customerOrders AND tableRequests — see the README note.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, addDoc, serverTimestamp, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHOW_aj_Ccux2VkMsocs4SEpSrrFIPst0",
  authDomain: "restro-billing-b61a6.firebaseapp.com",
  projectId: "restro-billing-b61a6",
  storageBucket: "restro-billing-b61a6.firebasestorage.app",
  messagingSenderId: "554440969043",
  appId: "1:554440969043:web:4818925230aad56c0aefa6",
  measurementId: "G-5E2W1K8R5B"
};
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

const $ = (id) => document.getElementById(id);
// Escapes item/category/table names before they go into innerHTML. These
// come from the restaurant's own menu (staff-controlled), so risk is lower
// than user input — but this page is public with no login, so every string
// that reaches innerHTML gets escaped on principle.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
const money = (n) => "₹" + (Math.round(n * 100) / 100).toFixed(2);

const params = new URLSearchParams(location.search);
const restoId = params.get("r");
const tableName = params.get("t");

let menuCache = [];

// ---- Veg / non-veg ----
// The menu builder saves veg as the strings "veg" / "nonveg" (older data may
// use false or "non-veg"), so we normalise instead of comparing to one value.
const DIET_KEY = "ord_diet_filter";
let dietFilter = "all";               // "all" | "veg" | "nonveg"
try { const d = sessionStorage.getItem(DIET_KEY); if (d === "veg" || d === "nonveg") dietFilter = d; } catch (e) {}
function isNonVeg(i) {
  const v = i && i.veg;
  if (v === false) return true;
  return typeof v === "string" && /^non[\s_-]?veg/i.test(v.trim());
}
function dietMatches(i) { return dietFilter === "all" || (dietFilter === "nonveg") === isNonVeg(i); }
function visibleMenu() { return menuCache.filter(dietMatches).filter(searchMatches); }
function vegDotHtml(i) {
  const nv = isNonVeg(i);
  return `<span class="ord-veg-dot ${nv ? "nonveg" : ""}" role="img" aria-label="${nv ? "Non-veg" : "Veg"}"></span>`;
}
let cart = []; // { key, name, variant, variantPrice, addons:[{name,price}], qty, note }
let activeSheetItem = null;
let sheetVariant = null;
let sheetAddons = [];
let sheetQty = 1;
// Multi-seat: an array of seat letters the customer confirmed, e.g. ["a","b","c"]
let selectedSeats = [];
let tableFloor = ""; // this table's floor, looked up at init — sent along with waiter calls

// ===================== SCREEN MANAGER =====================
const ALL_SCREENS = ["loadingScreen","disabledScreen","errorScreen","seatScreen","app","trackScreen","billScreen"];
function show(id) {
  // once the session is checked out, the bill is the only screen that can ever be shown
  if (typeof sessionEnded !== "undefined" && sessionEnded) id = "billScreen";
  ALL_SCREENS.forEach(s => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
}
function fail(msg) {
  $("errorMsg").textContent = msg;
  show("errorScreen");
}

// ===================== INIT =====================
async function init() {
  if (!restoId || !tableName) { fail("This QR code link looks invalid. Please ask staff for help."); return; }
  // this table's session was already checked out from this phone -> straight back to the bill, no ordering
  const doneCheckout = loadCheckout();
  if (doneCheckout) {
    sessionEnded = true;
    renderBill(doneCheckout);
    lockBackButton();
    show("billScreen");
    return;
  }
  try {
    // Reads from restaurants/{restoId}/public/info — a deliberately small,
    // publicly-readable doc — rather than the restaurant's main doc, which
    // also holds staffPinHash and other owner-only settings and is locked
    // to owner-auth-only reads. Keep this page from ever needing anything
    // beyond what's mirrored into that public doc.
    const restoSnap = await getDoc(doc(db, "restaurants", restoId, "public", "info"));
    if (!restoSnap.exists()) { fail("We couldn't find this restaurant. Please ask staff for help."); return; }
    const restoData = restoSnap.data();
    if (!restoData.qrOrderingEnabled) { show("disabledScreen"); return; }
    $("restoName").textContent = restoData.name || "Menu";
    $("tableNameLabel").textContent = tableName;
    $("trackRestoName").textContent = restoData.name || "Menu";
    $("trackTableLabel").textContent = tableName;

    // Menu: the POS keeps a single snapshot doc (public/menu) in sync, so each scan costs 1 read
    // instead of one read per menu item. Falls back to the full menu collection if the snapshot
    // is missing or not readable, so ordering never breaks.
    let menuItems = null;
    try {
      const mSnap = await getDoc(doc(db, "restaurants", restoId, "public", "menu"));
      if (mSnap.exists() && Array.isArray(mSnap.data().items)) menuItems = mSnap.data().items;
    } catch (e) { console.warn("Menu snapshot unavailable, reading menu directly", e); }
    if (!menuItems) {
      const menuSnap = await getDocs(collection(db, "restaurants", restoId, "menu"));
      menuItems = menuSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    menuCache = menuItems.filter(i => i.available !== false);

    // Look up how many chairs this table has (and which floor it's on) —
    // falls back to 4 seats / no floor if not found.
    let seatCount = 4;
    try {
      const tableSnap = await getDocs(query(collection(db, "restaurants", restoId, "tables"), where("name", "==", tableName)));
      if (!tableSnap.empty) {
        const tData = tableSnap.docs[0].data();
        seatCount = tData.seats || 4;
        tableFloor = tData.floor || "";
      }
    } catch (e) { console.warn("Table lookup failed, defaulting to 4 seats", e); }

    tableSeatCount = seatCount;
    showSeatScreen(seatCount);
    // customer already ordered from this phone? take them straight back to live status
    if (resumeTracking()) show("trackScreen");
  } catch (e) {
    console.error(e);
    fail("We couldn't load the menu right now. Please ask staff for help or try again.");
  }
}

// ===================== SEAT SCREEN — MULTI-SELECT =====================
// Customers tap every seat their party is occupying, then tap Confirm.
// This replaces the old single-tap-and-go flow.
function showSeatScreen(seatCount) {
  $("seatScreenTableName").textContent = "Table " + tableName;
  selectedSeats = [];

  const letters = "abcdefghijkl".slice(0, Math.min(12, Math.max(1, seatCount))).split("");

  $("seatGrid").innerHTML = letters.map(l => `
    <button type="button" class="ord-seat-btn" data-seat="${l}">
      <span class="ord-seat-btn-letter">${l.toUpperCase()}</span>
      <span class="ord-seat-btn-sub">Seat</span>
    </button>`).join("");

  $("seatGrid").querySelectorAll(".ord-seat-btn").forEach(btn => {
    btn.onclick = () => {
      const seat = btn.dataset.seat;
      if (selectedSeats.includes(seat)) {
        // deselect
        selectedSeats = selectedSeats.filter(s => s !== seat);
        btn.classList.remove("selected");
        btn.querySelector(".ord-seat-btn-sub").textContent = "Seat";
      } else {
        // select
        selectedSeats.push(seat);
        btn.classList.add("selected");
        btn.querySelector(".ord-seat-btn-sub").textContent = "✓ Selected";
      }
      refreshSeatConfirmBtn();
    };
  });

  refreshSeatConfirmBtn();
  show("seatScreen");
}

function refreshSeatConfirmBtn() {
  const btn = $("seatConfirmBtn");
  if (selectedSeats.length === 0) {
    btn.disabled = true;
    btn.textContent = "Select at least one seat";
  } else {
    btn.disabled = false;
    const labels = selectedSeats.map(s => s.toUpperCase()).join(", ");
    btn.textContent = `Confirm — Seat${selectedSeats.length > 1 ? "s" : ""} ${labels}`;
  }
}

$("seatConfirmBtn").onclick = () => {
  if (!selectedSeats.length) return;
  // Build the header pill label
  const sorted = [...selectedSeats].sort();
  const labels = sorted.map(s => s.toUpperCase()).join(", ");
  $("seatPillLabel").textContent = `Seat${sorted.length > 1 ? "s" : ""} ${labels}`;
  updateDietUI();
  renderCategoryTabs();
  renderMenu();
  show("app");
};

// "Call waiter" — available any time once the customer is in the ordering
// app (not just at the seat-picking step). Writes a waiterCalls doc; staff
// see it live on the QR Ordering dashboard, table + floor included, with a
// chime and a red dot on the tab so nobody misses it.
let waiterCallCooldownUntil = 0;
function refreshWaiterBtn() {
  const btn = $("callWaiterBtn");
  if (!btn) return;
  const remaining = Math.ceil((waiterCallCooldownUntil - Date.now()) / 1000);
  if (remaining > 0) {
    btn.disabled = true;
    btn.textContent = `🔔 Waiter notified (${remaining}s)`;
    setTimeout(refreshWaiterBtn, 500);
  } else {
    btn.disabled = false;
    btn.textContent = "🔔 Call waiter";
  }
}
if ($("callWaiterBtn")) {
  $("callWaiterBtn").onclick = async () => {
    if (Date.now() < waiterCallCooldownUntil) return;
    const btn = $("callWaiterBtn");
    btn.disabled = true;
    btn.textContent = "Notifying staff…";
    try {
      await addDoc(collection(db, "restaurants", restoId, "waiterCalls"), {
        tableName,
        floor: tableFloor,
        seatLabels: selectedSeats.length ? [...selectedSeats].sort() : [],
        status: "pending",
        createdAt: serverTimestamp()
      });
      // 60s cooldown so an excited table can't spam the dashboard.
      waiterCallCooldownUntil = Date.now() + 60000;
      refreshWaiterBtn();
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = "🔔 Call waiter";
      alert("Couldn't reach staff — please wave someone down directly.");
    }
  };
}

// ===================== MENU =====================
function categories() {
  const set = new Set(visibleMenu().map(i => i.category || "Menu"));
  return [...set];
}
let activeCat = null;

// ---- Search ----
let searchQuery = "";
function norm(s) { return String(s || "").toLowerCase().trim(); }
function searchMatches(i) {
  if (!searchQuery) return true;
  return norm(i.name).includes(searchQuery) || norm(i.category).includes(searchQuery) || norm(i.description).includes(searchQuery);
}
function headerHeight() { const h = document.querySelector(".ord-header"); return h ? h.offsetHeight : 0; }
// After the list changes (search / filter), bring the results into view under the sticky header.
function scrollToMenuTop() {
  const top = $("menuList").getBoundingClientRect().top + window.scrollY - headerHeight() - 4;
  if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
}
function refreshMenuView() {
  activeCat = null;
  renderCategoryTabs();
  renderMenu();
  scrollToMenuTop();
}
let searchTimer;
function applySearch(v) { searchQuery = norm(v); refreshMenuView(); }
{
  const si = $("menuSearchInput"), sc = $("searchClearBtn");
  si.addEventListener("input", () => {
    sc.classList.toggle("hidden", !si.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(si.value), 120);
  });
  si.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); si.blur(); } });
  sc.onclick = () => { si.value = ""; sc.classList.add("hidden"); applySearch(""); si.focus(); };
}

// ---- Category picker (replaces the sideways-scrolling tabs) ----
function renderCategoryTabs() {            // name kept so existing callers still work
  const cats = categories();
  if (!cats.includes(activeCat)) activeCat = cats[0] || null;
  $("catPickBtn").disabled = !cats.length;
  buildCatSheet(cats);
}
function buildCatSheet(cats) {
  const vis = visibleMenu();
  $("catGrid").innerHTML = cats.map(c => {
    const n = vis.filter(i => (i.category || "Menu") === c).length;
    return `<button type="button" class="ord-cat-tile${c === activeCat ? " on" : ""}" data-cat="${escapeHtml(c)}"><b>${escapeHtml(c)}</b><small>${n} item${n === 1 ? "" : "s"}</small></button>`;
  }).join("");
  $("catGrid").querySelectorAll(".ord-cat-tile").forEach(b => { b.onclick = () => jumpToCategory(b.dataset.cat); });
}
function openCatSheet() {
  buildCatSheet(categories());
  $("catOverlay").classList.remove("hidden");
  $("catSheet").classList.remove("hidden");
}
function closeCatSheet() {
  $("catOverlay").classList.add("hidden");
  $("catSheet").classList.add("hidden");
}
let spyHold = 0;
function jumpToCategory(c) {
  activeCat = c;
  closeCatSheet();
  const el = document.getElementById(`cat-${cssEscape(c)}`);
  if (!el) return;
  spyHold = Date.now() + 900;               // don't let scroll-spy fight the smooth scroll
  const y = el.getBoundingClientRect().top + window.scrollY - headerHeight() - 8;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}
// scroll-spy: keep the highlighted category in the picker in sync with what's on screen
let spyQueued = false;
function spy() {
  spyQueued = false;
  if (Date.now() < spyHold) return;
  const cats = categories(); if (!cats.length) return;
  const line = headerHeight() + 24;
  let cur = cats[0];
  for (const c of cats) {
    const el = document.getElementById(`cat-${cssEscape(c)}`);
    if (el && el.getBoundingClientRect().top <= line) cur = c;
  }
  if (window.scrollY > 50 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = cats[cats.length - 1];
  activeCat = cur;
}
window.addEventListener("scroll", () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
$("catPickBtn").onclick = openCatSheet;
$("closeCatBtn").onclick = closeCatSheet;
$("catOverlay").onclick = closeCatSheet;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeCatSheet(); });

// ---- Veg / Non-veg switches (tap again to turn off = show all) ----
function updateDietUI() {
  [["vegToggle", "veg"], ["nonvegToggle", "nonveg"]].forEach(([id, kind]) => {
    const b = $(id); if (!b) return;
    const on = dietFilter === kind;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
}
function setDietFilter(d) {
  dietFilter = d;
  try { sessionStorage.setItem(DIET_KEY, d); } catch (e) {}
  updateDietUI();
  refreshMenuView();
}
$("vegToggle").onclick = () => setDietFilter(dietFilter === "veg" ? "all" : "veg");
$("nonvegToggle").onclick = () => setDietFilter(dietFilter === "nonveg" ? "all" : "nonveg");

function cssEscape(s) { return s.replace(/[^a-zA-Z0-9]/g, "_"); }

function cartQtyForItem(itemId) {
  return cart.filter(c => c.itemId === itemId).reduce((s, c) => s + c.qty, 0);
}

function renderMenu() {
  const cats = categories();
  $("menuList").innerHTML = cats.map(cat => `
    <div id="cat-${cssEscape(cat)}">
      <div class="ord-cat-heading">${escapeHtml(cat)}</div>
      ${visibleMenu().filter(i => (i.category || "Menu") === cat).map(itemCardHtml).join("")}
    </div>
  `).join("") || `<div class="ord-empty-note">${searchQuery ? `No dishes found for “${escapeHtml($("menuSearchInput").value.trim())}”${dietFilter === "all" ? "" : ` in ${dietFilter === "veg" ? "veg" : "non-veg"}`}. Try another name.` : dietFilter === "all" ? "Menu isn't available right now." : `No ${dietFilter === "veg" ? "veg" : "non-veg"} items available right now.`}</div>`;

  document.querySelectorAll(".ord-item-card").forEach(card => {
    card.onclick = () => {
      openItemSheet(menuCache.find(i => i.id === card.dataset.id));
    };
  });
  document.querySelectorAll(".ord-item-stepper button").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      stepMenuItem(btn.closest(".ord-item-stepper").dataset.id, btn.dataset.act === "plus" ? 1 : -1);
    };
  });
  document.querySelectorAll(".ord-item-add-btn[data-simple]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const item = menuCache.find(i => i.id === btn.dataset.id);
      addSimpleItemToCart(item);
    };
  });
}

function itemCardHtml(i) {
  const inCartQty = cartQtyForItem(i.id);
  const hasOptions = (i.variants && i.variants.length) || (i.addons && i.addons.length);
  const priceLabel = i.variants?.length ? `From ${money(Math.min(...i.variants.map(v => v.price)))}` : money(i.basePrice || 0);
  return `
  <div class="ord-item-card" data-id="${i.id}">
    <div class="ord-item-main">
      <div class="ord-item-name">${vegDotHtml(i)}${escapeHtml(i.name)}</div>
      <div class="ord-item-price">${priceLabel}</div>
    </div>
    ${inCartQty
      ? `<div class="ord-item-stepper" data-id="${i.id}">
          <button type="button" data-act="minus" aria-label="Remove one ${escapeHtml(i.name)}">−</button>
          <span>${inCartQty}</span>
          <button type="button" data-act="plus" aria-label="Add one more ${escapeHtml(i.name)}">+</button>
        </div>`
      : `<button class="ord-item-add-btn" ${hasOptions ? "" : `data-simple data-id="${i.id}"`}>${hasOptions ? "Select" : "Add"}</button>`}
  </div>`;
}

// +1 / −1 straight from the menu card
function stepMenuItem(itemId, delta) {
  const item = menuCache.find(i => i.id === itemId);
  if (!item) return;
  const hasOptions = (item.variants && item.variants.length) || (item.addons && item.addons.length);
  const lines = cart.filter(c => c.itemId === itemId);
  if (delta > 0) {
    if (!hasOptions) { addSimpleItemToCart(item); return; }
    if (lines.length === 1) lines[0].qty += 1;
    else { openItemSheet(item); return; }   // several variants in the cart: let them choose which
  } else {
    const c = lines[lines.length - 1];
    if (!c) return;
    c.qty -= 1;
    if (c.qty <= 0) cart = cart.filter(x => x.key !== c.key);
  }
  refreshCartUI();
  renderMenu();
}

function addSimpleItemToCart(item) {
  const key = item.id;
  const existing = cart.find(c => c.key === key);
  const isNewAdd = !existing;
  if (existing) existing.qty += 1;
  else cart.push({ key, itemId: item.id, name: item.name, variant: null, unitPrice: item.basePrice || 0, addons: [], qty: 1 });
  refreshCartUI();
  renderMenu();
  if (isNewAdd) maybeShowUpsell(item);
}

// ===================== UPSELL SUGGESTIONS =====================
// Shown once per triggering item per visit, right after it's first added,
// so a customer adding a burger sees "goes great with: fries, coke" with a
// one-tap add — without nagging them again if they bump the qty later.
const upsellShownFor = new Set();
let upsellAutoHideTimer = null;
function maybeShowUpsell(triggerItem) {
  if (!triggerItem.upsellIds?.length || upsellShownFor.has(triggerItem.id)) return;
  const suggestions = triggerItem.upsellIds
    .map(id => menuCache.find(m => m.id === id))
    .filter(m => m && cartQtyForItem(m.id) === 0 && dietMatches(m));
  if (!suggestions.length) return;
  upsellShownFor.add(triggerItem.id);
  showUpsellPrompt(suggestions);
}
function showUpsellPrompt(items) {
  $("upsellItems").innerHTML = items.map(i => `
    <div class="ord-upsell-item" data-id="${i.id}">
      <div class="ord-upsell-item-main">
        ${vegDotHtml(i)}
        <div>
          <div class="ord-upsell-item-name">${escapeHtml(i.name)}</div>
          <div class="ord-upsell-item-price">${i.variants?.length ? "From " + money(Math.min(...i.variants.map(v => v.price))) : money(i.basePrice || 0)}</div>
        </div>
      </div>
      <button class="ord-upsell-add-btn" data-id="${i.id}">+ Add</button>
    </div>`).join("");
  $("upsellItems").querySelectorAll(".ord-upsell-add-btn").forEach(btn => {
    btn.onclick = () => {
      const item = menuCache.find(m => m.id === btn.dataset.id);
      if (!item) return;
      if (item.variants?.length || item.addons?.length) { hideUpsellPrompt(); openItemSheet(item); return; }
      addSimpleItemToCart(item);
      btn.textContent = "✓ Added";
      btn.disabled = true;
      btn.closest(".ord-upsell-item").classList.add("added");
    };
  });
  $("upsellPrompt").classList.remove("hidden");
  requestAnimationFrame(() => $("upsellPrompt").classList.add("shown"));
  clearTimeout(upsellAutoHideTimer);
  upsellAutoHideTimer = setTimeout(hideUpsellPrompt, 8000);
}
function hideUpsellPrompt() {
  clearTimeout(upsellAutoHideTimer);
  $("upsellPrompt").classList.remove("shown");
  setTimeout(() => $("upsellPrompt").classList.add("hidden"), 250);
}
if ($("upsellCloseBtn")) $("upsellCloseBtn").onclick = hideUpsellPrompt;

// ===================== ITEM DETAIL SHEET =====================
function openItemSheet(item) {
  activeSheetItem = item;
  sheetVariant = item.variants?.length ? item.variants[0] : null;
  sheetAddons = [];
  sheetQty = 1;
  $("sheetItemName").textContent = item.name;

  $("sheetVariants").innerHTML = item.variants?.length ? `
    <div class="ord-sheet-block-title">Choose an option</div>
    ${item.variants.map((v, idx) => `
      <div class="ord-opt-row ${idx === 0 ? "selected" : ""}" data-idx="${idx}">
        <span class="ord-opt-name">${escapeHtml(v.name)}</span><span class="ord-opt-price">${money(v.price)}</span>
      </div>`).join("")}` : "";
  $("sheetVariants").querySelectorAll(".ord-opt-row").forEach(row => {
    row.onclick = () => {
      sheetVariant = item.variants[row.dataset.idx];
      $("sheetVariants").querySelectorAll(".ord-opt-row").forEach(r => r.classList.remove("selected"));
      row.classList.add("selected");
      updateSheetAddBtn();
    };
  });

  $("sheetAddons").innerHTML = item.addons?.length ? `
    <div class="ord-sheet-block-title">Add-ons</div>
    ${item.addons.map((a, idx) => `
      <div class="ord-opt-row" data-idx="${idx}">
        <span class="ord-opt-name">${escapeHtml(a.name)}</span><span class="ord-opt-price">+${money(a.price)}</span>
      </div>`).join("")}` : "";
  $("sheetAddons").querySelectorAll(".ord-opt-row").forEach(row => {
    row.onclick = () => {
      const addon = item.addons[row.dataset.idx];
      const idx = sheetAddons.findIndex(a => a.name === addon.name);
      if (idx >= 0) { sheetAddons.splice(idx, 1); row.classList.remove("selected"); }
      else { sheetAddons.push(addon); row.classList.add("selected"); }
      updateSheetAddBtn();
    };
  });

  $("sheetQtyVal").textContent = sheetQty;
  updateSheetAddBtn();
  $("itemSheet").classList.remove("hidden");
  $("itemSheetOverlay").classList.remove("hidden");
}

function sheetUnitPrice() {
  const base = sheetVariant ? sheetVariant.price : (activeSheetItem.basePrice || 0);
  const addonsTotal = sheetAddons.reduce((s, a) => s + (a.price || 0), 0);
  return base + addonsTotal;
}
function updateSheetAddBtn() {
  $("sheetAddBtn").textContent = `Add to order — ${money(sheetUnitPrice() * sheetQty)}`;
}

$("sheetQtyMinus").onclick = () => {
  sheetQty = Math.max(1, sheetQty - 1);
  $("sheetQtyVal").textContent = sheetQty;
  updateSheetAddBtn();
};
$("sheetQtyPlus").onclick = () => {
  sheetQty += 1;
  $("sheetQtyVal").textContent = sheetQty;
  updateSheetAddBtn();
};

function closeItemSheet() {
  $("itemSheet").classList.add("hidden");
  $("itemSheetOverlay").classList.add("hidden");
}
$("closeSheetBtn").onclick = closeItemSheet;
$("itemSheetOverlay").onclick = closeItemSheet;

$("sheetAddBtn").onclick = () => {
  const key = activeSheetItem.id + "|" + (sheetVariant?.name || "") + "|" + sheetAddons.map(a => a.name).sort().join(",");
  const existing = cart.find(c => c.key === key);
  const triggerItem = activeSheetItem;
  if (existing) existing.qty += sheetQty;
  else cart.push({
    key, itemId: activeSheetItem.id, name: activeSheetItem.name,
    variant: sheetVariant?.name || null, unitPrice: sheetUnitPrice(), addons: sheetAddons.slice(), qty: sheetQty
  });
  closeItemSheet();
  refreshCartUI();
  renderMenu();
  maybeShowUpsell(triggerItem);
};

// ===================== CART =====================
function cartTotal() { return cart.reduce((s, c) => s + c.unitPrice * c.qty, 0); }
function cartCount() { return cart.reduce((s, c) => s + c.qty, 0); }

function refreshCartUI() {
  const count = cartCount();
  $("cartFab").classList.toggle("hidden", count === 0);
  $("cartFabCount").textContent = count;
  $("cartTotal").textContent = money(cartTotal());
  $("cartItems").innerHTML = cart.length ? cart.map(c => `
    <div class="ord-cart-item-row" data-key="${c.key}">
      <div class="ord-cart-item-main">
        <div class="ord-cart-item-name">${escapeHtml(c.name)}${c.variant ? ` (${escapeHtml(c.variant)})` : ""}</div>
        ${c.addons.length ? `<div class="ord-cart-item-sub">+ ${escapeHtml(c.addons.map(a => a.name).join(", "))}</div>` : ""}
      </div>
      <div class="ord-cart-qty-stepper">
        <button data-act="minus">−</button>
        <span>${c.qty}</span>
        <button data-act="plus">+</button>
      </div>
      <div class="ord-cart-item-price">${money(c.unitPrice * c.qty)}</div>
    </div>`).join("") : `<div class="ord-empty-note">Your order is empty.</div>`;

  $("cartItems").querySelectorAll(".ord-cart-item-row").forEach(row => {
    const c = cart.find(x => x.key === row.dataset.key);
    row.querySelector("[data-act='minus']").onclick = () => {
      c.qty -= 1;
      if (c.qty <= 0) cart = cart.filter(x => x.key !== c.key);
      refreshCartUI(); renderMenu();
    };
    row.querySelector("[data-act='plus']").onclick = () => { c.qty += 1; refreshCartUI(); renderMenu(); };
  });
}

$("cartFab").onclick = () => { $("cartDrawer").classList.remove("hidden"); $("cartOverlay").classList.remove("hidden"); };
$("closeCartBtn").onclick = () => { $("cartDrawer").classList.add("hidden"); $("cartOverlay").classList.add("hidden"); };
$("cartOverlay").onclick = () => { $("cartDrawer").classList.add("hidden"); $("cartOverlay").classList.add("hidden"); };

// ===================== PLACE ORDER =====================
$("placeOrderBtn").onclick = async () => {
  if (sessionEnded || !cart.length) return;
  const custName = $("custNameInput").value.trim();
  if (!custName) {
    alert("Please enter your name before sending the order — it helps staff find you at the table.");
    $("custNameInput").focus();
    return;
  }
  let custPhone = $("custPhoneInput").value.replace(/\D/g, "");
  if (custPhone.length === 12 && custPhone.startsWith("91")) custPhone = custPhone.slice(2);
  else if (custPhone.length === 11 && custPhone.startsWith("0")) custPhone = custPhone.slice(1);
  if (!/^[6-9]\d{9}$/.test(custPhone)) {
    alert("Please enter a valid 10-digit mobile number — we'll send your bill on WhatsApp.");
    $("custPhoneInput").focus();
    return;
  }
  $("placeOrderBtn").disabled = true;
  $("placeOrderBtn").textContent = "Sending…";
  try {
    // selectedSeats is now an array like ["a","b","c"]
    const placedRef = await addDoc(collection(db, "restaurants", restoId, "customerOrders"), {
      tableName,
      seatLabels: selectedSeats.length ? [...selectedSeats].sort() : [],
      customerName: custName,
      customerPhone: custPhone,
      items: cart.map(c => ({ itemId: c.itemId, name: c.name, variant: c.variant, qty: c.qty, price: c.unitPrice, addons: c.addons.map(a => a.name), note: "" })),
      total: cartTotal(),
      status: "pending",
      createdAt: serverTimestamp()
    });
    const placedSnap = {
      customerName: custName, seatLabels: [...selectedSeats].sort(), total: cartTotal(),
      items: cart.map(c => ({ name: c.name, variant: c.variant, qty: c.qty, price: c.unitPrice, addons: c.addons.map(a => a.name) }))
    };
    cart = [];
    $("cartDrawer").classList.add("hidden");
    $("cartOverlay").classList.add("hidden");
    trackOrder(placedRef.id, placedSnap);
    show("trackScreen");
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    alert("Couldn't send your order — please try again or call staff.");
  }
  $("placeOrderBtn").disabled = false;
  $("placeOrderBtn").textContent = "Send order to kitchen";
};

// ===================== LIVE ORDER TRACKER =====================
// After ordering, the customer's phone follows each order live:
// Received -> Preparing -> Ready -> Served, driven by the kitchen display.
const TRACK_KEY = `zs_orders_${restoId}_${tableName}`;
const TRACK_TTL = 4 * 3600 * 1000;      // stop following orders after 4 hours
const TRACK_DONE_HIDE = 90 * 60 * 1000; // hide a finished order 90 min after it was served
let tableSeatCount = 4;
const trackUnsubs = {};   // customerOrders doc id -> unsubscribe fn
const trackData = {};     // customerOrders doc id -> latest data
const trackPrevStage = {};
let trackFailed = false;
let trackErrCode = "";

const TRACK_STEPS = [
  { label: "Order received", sub: "Your order is with our team" },
  { label: "Preparing", sub: "The kitchen is cooking it" },
  { label: "Ready", sub: "Dispatched from the kitchen" },
  { label: "Served", sub: "Enjoy your meal!" }
];

function loadTracked() {
  try {
    const arr = JSON.parse(localStorage.getItem(TRACK_KEY) || "[]");
    return arr.filter(x => x && x.id && Date.now() - x.t < TRACK_TTL);
  } catch (e) { return []; }
}
function saveTracked(arr) { try { localStorage.setItem(TRACK_KEY, JSON.stringify(arr)); } catch (e) {} }

// -1 rejected, 0 received, 1 preparing, 2 ready, 3 served
function trackStage(o) {
  if (o.status === "rejected") return -1;
  if (o.billed || o.kdsCleared) return 3;
  if (o.status !== "approved") return 0;
  const k = o.kitchenStatus || "new";
  return k === "preparing" ? 1 : k === "ready" ? 2 : 0;
}

function trackOrder(id, snap) {
  const arr = loadTracked();
  if (!arr.some(x => x.id === id)) { arr.push(snap ? { id, t: Date.now(), snap } : { id, t: Date.now() }); saveTracked(arr); }
  subscribeTracked(id);
}
function untrack(id) {
  if (trackUnsubs[id]) { trackUnsubs[id](); delete trackUnsubs[id]; }
  delete trackData[id];
  saveTracked(loadTracked().filter(x => x.id !== id));
}
function subscribeTracked(id) {
  if (trackUnsubs[id]) return;
  trackUnsubs[id] = onSnapshot(doc(db, "restaurants", restoId, "customerOrders", id), (snap) => {
    if (!snap.exists()) { untrack(id); renderTracker(); return; }
    const o = snap.data();
    const stage = trackStage(o);
    const ms = (o.statusUpdatedAt?.toMillis?.() || o.createdAt?.toMillis?.() || Date.now());
    if ((stage === 3 || stage === -1) && Date.now() - ms > TRACK_DONE_HIDE) { untrack(id); renderTracker(); return; }
    // a little buzz when the food leaves the kitchen
    if (stage === 2 && trackPrevStage[id] !== undefined && trackPrevStage[id] < 2 && navigator.vibrate) navigator.vibrate([180, 80, 180]);
    trackPrevStage[id] = stage;
    trackData[id] = o;
    trackFailed = false;
    renderTracker();
  }, (err) => {
    console.warn("Order tracking unavailable", err);
    trackFailed = true;
    trackErrCode = (err && (err.code || err.message)) || "unknown";
    renderTracker();
  });
}
function resumeTracking() {
  const arr = loadTracked();
  if (!arr.length) return false;
  arr.forEach(x => subscribeTracked(x.id));
  return true;
}

function trackHeadline(o) {
  const stage = trackStage(o);
  if (stage === -1) return { ico: "⚠️", h: "Order couldn't be accepted", p: "Please call a staff member and we'll sort it out.", bad: true };
  if (stage === 0 && o.status !== "approved") return { ico: "🧾", h: "Order received", p: "We've got it! Waiting for staff to confirm." };
  if (stage === 0) return { ico: "✅", h: "Order confirmed", p: "Sent to the kitchen — they'll start shortly." };
  if (stage === 1) return { ico: "🔥", h: "Being prepared", p: "Your food is being cooked right now." };
  if (stage === 2) return { ico: "🛎️", h: "Ready — on its way!", p: "Your order has left the kitchen and is coming to your table." };
  return { ico: "🍽️", h: "Served — enjoy!", p: "Hope you love it. You can order more anytime." };
}

function renderTracker() {
  const list = $("trackList");
  const order = loadTracked().map(x => x.id).filter(id => trackData[id]);
  $("trackNotice").classList.toggle("hidden", !(trackFailed && !order.length));
  $("trackNotice").textContent = "Live status isn't available right now, but your order has been sent. Please ask a staff member for an update." + (trackErrCode ? " [" + trackErrCode + "]" : "");
  refreshTrackBtn();
  refreshCheckoutBtn();

  if (!order.length) {
    list.innerHTML = "";
    $("trackHeroIcon").textContent = "🧾";
    $("trackHeadline").textContent = trackFailed ? "Order sent" : "Checking your order…";
    $("trackSubline").textContent = trackFailed ? "The kitchen has it." : "Just a moment";
    $("trackHero").classList.remove("rejected");
    return;
  }

  // hero follows the order that is furthest from being finished
  const live = order.filter(id => { const s = trackStage(trackData[id]); return s >= 0 && s < 3; });
  const heroId = live.length ? live.reduce((a, b) => trackStage(trackData[a]) <= trackStage(trackData[b]) ? a : b) : order[order.length - 1];
  const hl = trackHeadline(trackData[heroId]);
  $("trackHeroIcon").textContent = hl.ico;
  $("trackHeadline").textContent = hl.h;
  $("trackSubline").textContent = hl.p;
  $("trackHero").classList.toggle("rejected", !!hl.bad);

  list.innerHTML = order.slice().reverse().map((id) => {
    const o = trackData[id];
    const n = order.indexOf(id) + 1;
    const stage = trackStage(o);
    const items = o.items || [];
    const qty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const itemsHtml = items.map(i => `<li><span>${escapeHtml(i.qty)}× ${escapeHtml(i.name)}${i.variant ? ` (${escapeHtml(i.variant)})` : ""}</span></li>`).join("");
    if (stage === -1) {
      return `<div class="ord-trk-card rejected"><div class="ord-trk-head"><div><b>Order ${n}</b><small>${qty} item${qty === 1 ? "" : "s"} · ${money(o.total || 0)}</small></div><span class="ord-trk-badge bad">Not accepted</span></div>
        <div class="ord-trk-reject">Sorry — this order couldn't be accepted. Please speak to a staff member.</div></div>`;
    }
    const badge = TRACK_STEPS[stage].label;
    const steps = TRACK_STEPS.map((st, i) => {
      const cls = i < stage ? "done" : i === stage ? (stage === 3 ? "done" : "active") : "";
      let sub = st.sub;
      if (i === 0) sub = o.status === "approved" ? "Confirmed and sent to the kitchen" : "Waiting for staff to confirm";
      return `<li class="ord-trk-step ${cls}"><span class="ord-trk-dot">${cls === "done" ? "✓" : i + 1}</span>
        <span class="ord-trk-step-txt"><b>${st.label}</b><small>${cls ? sub : ""}</small></span></li>`;
    }).join("");
    return `<div class="ord-trk-card ${stage === 3 ? "finished" : ""}">
      <div class="ord-trk-head"><div><b>Order ${n}</b><small>${qty} item${qty === 1 ? "" : "s"} · ${money(o.total || 0)}</small></div><span class="ord-trk-badge s${stage}">${badge}</span></div>
      <ol class="ord-trk-steps">${steps}</ol>
      <details class="ord-trk-items"><summary>View items (${qty})</summary><ul>${itemsHtml}</ul></details>
    </div>`;
  }).join("");
}

function refreshTrackBtn() {
  const btn = $("trackOrderBtn"); if (!btn) return;
  const ids = loadTracked().map(x => x.id).filter(id => trackData[id]);
  btn.classList.toggle("hidden", !ids.length);
  const active = ids.filter(id => { const s = trackStage(trackData[id]); return s >= 0 && s < 3; }).length;
  btn.classList.toggle("live", active > 0);
}
if ($("trackOrderBtn")) $("trackOrderBtn").onclick = () => { renderTracker(); show("trackScreen"); window.scrollTo(0, 0); };

$("orderAgainBtn").onclick = () => {
  if (sessionEnded) { show("billScreen"); return; }
  if (selectedSeats.length) { refreshCartUI(); renderMenu(); show("app"); }
  else showSeatScreen(tableSeatCount);   // page was reloaded — seats need picking again
};

// ===================== CHECKOUT — END THE DINE-IN SESSION =====================
// "Checkout" freezes everything the customer has ordered into a bill, ends the
// session for this phone + table and shows the "pay at the Cafe Reception" screen.
// The ended state is saved in localStorage, so reloading, re-scanning the QR or
// pressing Back can never reopen the menu. (A fresh session is possible again
// after CHECKOUT_TTL, or once the browser data is cleared.)
const CHECKOUT_KEY = `zs_checkout_${restoId}_${tableName}`;
const CHECKOUT_TTL = 6 * 3600 * 1000;
let sessionEnded = false;
let backLocked = false;

function loadCheckout() {
  try {
    const c = JSON.parse(localStorage.getItem(CHECKOUT_KEY) || "null");
    return c && c.t && Date.now() - c.t < CHECKOUT_TTL ? c : null;
  } catch (e) { return null; }
}

// Everything ordered in this session (rejected orders excluded), merged line by line.
function buildBill() {
  const lines = new Map();
  const seats = new Set();
  let orders = 0, pending = 0, ordersTotal = 0, name = "";
  loadTracked().forEach(e => {
    const o = trackData[e.id] || e.snap;
    if (!o) return;
    const stage = trackStage(o);
    if (stage === -1) return;
    orders++;
    if (stage < 3) pending++;
    ordersTotal += Number(o.total) || 0;
    name = name || o.customerName || "";
    (o.seatLabels || []).forEach(s => seats.add(String(s).toUpperCase()));
    (o.items || []).forEach(i => {
      const price = Number(i.price) || 0;
      const addons = Array.isArray(i.addons) ? i.addons : [];
      const key = [i.name, i.variant || "", addons.join(","), price].join("|");
      const cur = lines.get(key) || { name: i.name, variant: i.variant || "", addons, price, qty: 0 };
      cur.qty += Number(i.qty) || 0;
      lines.set(key, cur);
    });
  });
  const list = [...lines.values()];
  const linesTotal = list.reduce((s, l) => s + l.price * l.qty, 0);
  return { orders, pending, name, seats: [...seats].sort(), lines: list, total: list.length ? linesTotal : ordersTotal };
}

function refreshCheckoutBtn() {
  const b = $("checkoutBtn"); if (!b) return;
  b.disabled = sessionEnded || buildBill().orders === 0;
}

function openCheckoutSheet() {
  if (sessionEnded) return;
  const bill = buildBill();
  if (!bill.orders) return;
  $("coSumAmt").textContent = money(bill.total);
  $("coSumLbl").textContent = `Your bill so far · ${bill.orders} order${bill.orders === 1 ? "" : "s"}`;
  $("coPending").classList.toggle("hidden", !bill.pending);
  $("coConfirmBtn").disabled = false;
  $("coOverlay").classList.remove("hidden");
  $("coSheet").classList.remove("hidden");
}
function closeCheckoutSheet() {
  $("coOverlay").classList.add("hidden");
  $("coSheet").classList.add("hidden");
}

function finishCheckout() {
  if (sessionEnded) return;
  const bill = buildBill();
  const snap = {
    t: Date.now(),
    restoName: $("restoName").textContent || "",
    tableName,
    ref: "T" + String(tableName).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) + "-" + Date.now().toString(36).toUpperCase().slice(-5),
    name: bill.name, seats: bill.seats, orders: bill.orders, lines: bill.lines, total: bill.total
  };
  try { localStorage.setItem(CHECKOUT_KEY, JSON.stringify(snap)); } catch (e) {}
  sessionEnded = true;

  // shut down everything that could lead back to ordering
  cart = [];
  closeCheckoutSheet(); closeItemSheet(); closeCatSheet();
  $("cartDrawer").classList.add("hidden"); $("cartOverlay").classList.add("hidden");
  hideUpsellPrompt();
  Object.keys(trackUnsubs).forEach(id => { try { trackUnsubs[id](); } catch (e) {} delete trackUnsubs[id]; });
  try { localStorage.removeItem(TRACK_KEY); } catch (e) {}

  // heads-up for staff (best effort — the bill screen works even if this fails)
  addDoc(collection(db, "restaurants", restoId, "waiterCalls"), {
    tableName, floor: tableFloor, seatLabels: bill.seats.map(s => s.toLowerCase()),
    type: "checkout", note: "Checkout — guest will pay at reception",
    status: "pending", createdAt: serverTimestamp()
  }).catch(e => console.warn("Couldn't notify staff of checkout", e));

  renderBill(snap);
  lockBackButton();
  show("billScreen");
  window.scrollTo(0, 0);
  if (navigator.vibrate) navigator.vibrate(60);
}

function renderBill(b) {
  $("billRestoName").textContent = b.restoName || $("restoName").textContent || "Bill";
  $("billTableLabel").textContent = b.tableName || tableName;
  $("billAmount").textContent = money(b.total || 0);
  $("billTotal").textContent = money(b.total || 0);
  $("billName").textContent = b.name || "Guest";
  $("billTableSeats").textContent = (b.tableName || tableName) + (b.seats && b.seats.length ? " · Seat" + (b.seats.length > 1 ? "s " : " ") + b.seats.join(", ") : "");
  $("billWhen").textContent = new Date(b.t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  $("billRef").textContent = b.ref || "—";
  $("billLines").innerHTML = (b.lines && b.lines.length) ? b.lines.map(l => {
    const sub = [l.variant, (l.addons && l.addons.length) ? "+ " + l.addons.join(", ") : ""].filter(Boolean).join(" · ");
    return `<li><span class="q">${escapeHtml(l.qty)}×</span><span class="n">${escapeHtml(l.name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</span><span class="a">${money(l.price * l.qty)}</span></li>`;
  }).join("") : `<li class="ord-receipt-empty" style="display:block">Your bill will be prepared at the reception.<br><span class="hi" lang="hi">आपका बिल रिसेप्शन पर तैयार किया जाएगा।</span></li>`;
}

// Back button: the bill page re-pushes itself so Back can't walk out into the menu.
function lockBackButton() {
  if (backLocked) return;
  backLocked = true;
  try {
    history.pushState({ zsEnded: 1 }, "", location.href);
    window.addEventListener("popstate", () => { try { history.pushState({ zsEnded: 1 }, "", location.href); } catch (e) {} });
  } catch (e) {}
}

$("checkoutBtn").onclick = openCheckoutSheet;
$("coCancelBtn").onclick = closeCheckoutSheet;
$("coOverlay").onclick = closeCheckoutSheet;
$("coConfirmBtn").onclick = () => { $("coConfirmBtn").disabled = true; finishCheckout(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeCheckoutSheet(); });

init();