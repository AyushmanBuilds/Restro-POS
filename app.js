// ===================== FIREBASE SETUP =====================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, onSnapshot, query, orderBy, serverTimestamp,
  runTransaction, where, getDocs,
  limit, startAfter, Timestamp, getCountFromServer
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
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ===================== TEST-MODE SWITCH =====================
// While this is being trialled at a single cafe, there's no need to make
// staff sign in with an email/password every time the POS opens. Flip this
// back to `true` before selling the software to a customer — the full
// email/password sign-in screen (and per-cafe data privacy that comes with
// it) is still fully wired up below and will come straight back.
const REQUIRE_LOGIN = true;

// ===================== STATE =====================
let currentUser = null;
let restoId = null;
let restoData = {};
let unsubTables = null, unsubMenu = null, unsubBills = null, unsubOpenOrders = null, unsubStock = null;

let tablesCache = [];
let menuCache = [];      // flat list of items
let billsCache = [];
// Live bill window (see BILL HISTORY section): only the last LIVE_BILL_DAYS days stream live.
const LIVE_BILL_DAYS = 35;
let billsWindowStart = null;
let olderBillsCache = [];        // older bills loaded on demand for Sales Summary
let olderLoadedFrom = null;      // oldest date loaded into olderBillsCache (null = none)
let olderSearchResults = [];     // results of "Search older bills"
let olderState = null;
let publicMenuSig = null, publicMenuChecked = false, publicMenuTimer = null;
let openOrdersCache = []; // all orders with status:"open", across all tables — drives seat occupancy
let kdsInitialLoadDone = false;   // suppress chime on first snapshot load
let customerOrdersInitialLoadDone = false; // suppress chime on first snapshot load
let waiterCallsInitialLoadDone = false;    // suppress chime on first snapshot load
let kdsSoundOn = localStorage.getItem("kdsSoundOn") !== "off";
let alertLastRing = 0; // declared early: playNotifSound() reads it before the alert engine section runs

// ---- Notification sound settings (per event type) ----
// Each event (kds = new kitchen ticket, qrorder = new QR order from a
// customer, waiter = "call waiter" press) can have its own ringtone and can
// be muted independently. Saved to Firestore (restoData.notificationSettings)
// so the choice follows the account across devices, and mirrored to
// localStorage for an instant read on page load before Firestore responds.
const NOTIF_SOUND_DEFAULTS = { kds: "bell", qrorder: "chime", waiter: "urgent" };
let notifSoundSettings = (() => {
  try { return { ...NOTIF_SOUND_DEFAULTS, ...JSON.parse(localStorage.getItem("notifSoundSettings") || "{}") }; }
  catch (e) { return { ...NOTIF_SOUND_DEFAULTS }; }
})();
let stockCache = [];      // grocery / inventory items (legacy, unused)
let expensesCache = [];
let reservationsCache = [];
let waitlistCache = [];
let customerOrdersCache = [];
let waiterCallsCache = []; // pending "call waiter" requests from the QR ordering pages
let editingExpenseId = null;
let editingReservationId = null;
let unsubExpenses = null, unsubReservations = null, unsubWaitlist = null, unsubCustomerOrders = null, unsubWaiterCalls = null;

// ---- Sidebar unread-activity dots ----
// Tabs whose content has changed since staff last opened them. A tab's dot
// clears the instant that tab is opened (see showView) and is re-added the
// next time something new arrives for it.
let notifiedTabs = new Set();
function notifyTab(tab) {
  if ($("view-" + tab)?.classList.contains("active")) return; // already looking at it
  notifiedTabs.add(tab);
  renderNavDots();
}
function renderNavDots() {
  document.querySelectorAll(".nav-dot").forEach(dot => {
    dot.classList.toggle("show", notifiedTabs.has(dot.dataset.dot));
  });
}

let activeTable = null;      // table object currently open for ordering
let activeSeatLabels = [];   // seat letters (e.g. ["a","b"]) this order covers
let currentOrder = null;     // {id?, tableId, items:[], status}
let cart = [];               // items in the order being built
let activeCategory = null;   // null = showing the category-box landing grid (PetPooja style)
let pickingItem = null;      // item currently in the pick modal
let staffUpsellShownFor = new Set(); // items already suggested-for this table's order, reset per table
let editingItemId = null;    // menu item being edited in item modal
let editingStockId = null;   // stock item being edited in stock modal
let orderType = "dinein";    // dinein | takeaway | delivery — for the order currently being built
let paymentMode = "cash";    // cash | card | upi — how this order is being paid for
let salesPeriod = "day";     // day | week | month | year — for the Sales Summary view
let seatPickerTable = null;  // table currently open in the seat-picker modal
let seatPickerSelected = []; // seat letters currently tapped/selected in the seat picker

// ---- Staff Management (password-locked) ----
let staffCache = [];          // staff member docs
let todayAttendanceCache = []; // attendance docs for today only, across all staff (drives live status on cards)
let unsubStaff = null, unsubTodayAttendance = null;
let staffUnlocked = false;    // unlocked once per browser session; only "Lock now" / sign-out / closing the tab re-locks it
let staffRangeAttCache = [];  // attendance docs for this month + last 7 days, drives the staff cards
let unsubRangeAttendance = null;
let editingStaffId = null;    // staff member being edited in staff modal
let calendarStaffId = null;   // staff member whose attendance calendar is open
let calendarMonthDate = new Date(); // first-of-month date currently shown in the attendance calendar

// ===================== VERNACULAR (HINDI) TOGGLE — KDS & WAITER VIEW =====================
// Kitchen and floor staff in many smaller-city restaurants are far more
// comfortable reading Hindi than English. This is a lightweight UI-string
// swap (not a full i18n framework) covering exactly the screens staff use
// on the floor: Kitchen Display and the Waiter Calls panel. Customer-facing
// screens, menu names, and all owner/back-office screens stay in English.
let staffLang = localStorage.getItem("staffLang") || "en";
const STAFF_TRANSLATIONS = {
  hi: {
    "New": "नया", "Preparing": "बन रहा है", "Ready": "तैयार",
    "Start preparing": "बनाना शुरू करें", "Mark ready": "तैयार है",
    "Served / Clear": "परोसा गया / हटाएं",
    "🔔 Waiter calls": "🔔 वेटर बुलाया गया",
    "Asked for a waiter": "वेटर को बुलाया",
    "just now": "अभी अभी", "m ago": "मिनट पहले",
    "✅ Resolved": "✅ हो गया",
    "✅ Approve": "✅ स्वीकार करें", "✕ Reject": "✕ अस्वीकार करें",
    "No waiter calls right now.": "अभी कोई वेटर कॉल नहीं है।",
    "No incoming customer orders right now.": "अभी कोई नया ऑर्डर नहीं है।",
    "Table": "टेबल", "Seat": "सीट", "Kitchen Display": "किचन डिस्प्ले",
    "item": "आइटम", "items": "आइटम्स", "Guest": "ग्राहक",
    "Approve": "स्वीकार करें", "Reject": "अस्वीकार करें", "Resolved": "हो गया", "Waiter calls": "वेटर कॉल",
  }
};
function t(str) {
  if (staffLang === "en") return str;
  return (STAFF_TRANSLATIONS.hi && STAFF_TRANSLATIONS.hi[str]) || str;
}
function setStaffLang(lang) {
  staffLang = lang;
  localStorage.setItem("staffLang", lang);
  [$("kdsLangToggle"), $("waiterLangToggle")].forEach(btn => {
    if (btn) btn.textContent = lang === "hi" ? "🌐 English" : "🌐 हिंदी";
  });
  if ($("view-kds")?.classList.contains("active")) renderKds();
  if ($("view-qrorder")?.classList.contains("active")) renderQrOrderingView();
}
function toggleStaffLang() { setStaffLang(staffLang === "hi" ? "en" : "hi"); }
const STAFF_AVATAR_COLORS = ["#1B5E4A", "#0E7C7B", "#1C8A4B", "#B7791F", "#5B4FBE", "#C4293D", "#1D7BB8", "#2F8F6E"];

// PetPooja-style category tile colours — cycled in order, independent of how
// many categories exist.
const CAT_COLORS = [
  "#1B5E4A", "#0E7C7B", "#1C8A4B", "#B7791F", "#5B4FBE",
  "#C4293D", "#1D7BB8", "#B0562C", "#2F8F6E", "#8B4A9C",
  "#C77B1E", "#3A6EA5", "#A13E6B", "#4F8A3D", "#B23B5E"
];
function catColor(idx) { return CAT_COLORS[idx % CAT_COLORS.length]; }
function catIcon(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("pizza")) return "🍕";
  if (n.includes("pasta")) return "🍝";
  if (n.includes("burger") || n.includes("sandwich")) return "🍔";
  if (n.includes("dessert") || n.includes("ice cream")) return "🍨";
  if (n.includes("tea") || n.includes("coffee")) return "☕";
  if (n.includes("mocktail") || n.includes("shake") || n.includes("beverage")) return "🥤";
  if (n.includes("bread")) return "🫓";
  if (n.includes("rice") || n.includes("biryani")) return "🍚";
  if (n.includes("noodle") || n.includes("chinese")) return "🥡";
  if (n.includes("south indian")) return "🥘";
  if (n.includes("tandoor") || n.includes("grill")) return "🍢";
  if (n.includes("wrap") || n.includes("roll")) return "🌯";
  if (n.includes("combo") || n.includes("thali")) return "🍱";
  if (n.includes("bakery") || n.includes("snack")) return "🥐";
  if (n.includes("soup")) return "🍲";
  if (n.includes("salad")) return "🥗";
  if (n.includes("non-veg") || n.includes("nonveg")) return "🍗";
  if (n.includes("veg")) return "🥦";
  return "🍽";
}


// ===================== CATEGORY TILE ARTWORK =====================
// Every category gets its own colour scene (themed gradient + food illustration).
// To use a real photo instead, drop a file named after the category into
// img/categories/ — e.g. "Tea & Coffee" -> img/categories/tea-and-coffee.jpg.
// If the photo exists it is used automatically; if not, the illustrated tile shows.
const CAT_ART = [
  { m: ["mocktail", "shake"],          e: ["🍹", "🥤", "🍓"], a: "#7A4FB0", b: "#3A2170" },
  { m: ["ice cream", "icecream"],      e: ["🍨", "🍦", "🍧"], a: "#2E86C9", b: "#143F73" },
  { m: ["tea", "coffee"],              e: ["☕", "🫖", "🍂"], a: "#7A4A30", b: "#2E1A10" },
  { m: ["beverage", "drink", "juice"], e: ["🥤", "🧃", "🧊"], a: "#1F86B0", b: "#0B4663" },
  { m: ["pizza"],                      e: ["🍕", "🧀", "🍅"], a: "#D2492E", b: "#7A1E10" },
  { m: ["pasta"],                      e: ["🍝", "🍅", "🧄"], a: "#CC5A3A", b: "#74241A" },
  { m: ["burger", "sandwich"],         e: ["🍔", "🍟", "🥬"], a: "#D98A2B", b: "#7A420B" },
  { m: ["wrap", "roll"],               e: ["🌯", "🥙", "🌿"], a: "#C9803E", b: "#6E3714" },
  { m: ["dessert", "sweet", "cake"],   e: ["🍰", "🍮", "🍫"], a: "#C4527F", b: "#6B2043" },
  { m: ["bakery", "snack"],            e: ["🥐", "🧁", "🍪"], a: "#C98F4F", b: "#744719" },
  { m: ["soup"],                       e: ["🍲", "🥣", "🌿"], a: "#D9903E", b: "#85470F" },
  { m: ["salad"],                      e: ["🥗", "🥬", "🍅"], a: "#3F9244", b: "#1B5527" },
  { m: ["bread", "naan", "roti"],      e: ["🫓", "🥖", "🧈"], a: "#C9A25A", b: "#745318" },
  { m: ["non-veg", "nonveg", "non veg"], e: ["🍗", "🍖", "🍛"], a: "#A93E2C", b: "#5A1810" },
  { m: ["veg"],                        e: ["🍛", "🥦", "🫛"], a: "#2F8352", b: "#15472B" },
  { m: ["rice", "biryani"],            e: ["🍚", "🍛", "🌿"], a: "#D5A63A", b: "#86600C" },
  { m: ["noodle", "chinese"],          e: ["🍜", "🥡", "🥢"], a: "#C4462D", b: "#681C10" },
  { m: ["south indian"],               e: ["🥘", "🥥", "🌶️"], a: "#DDA13B", b: "#8F550B" },
  { m: ["tandoor", "grill"],           e: ["🍢", "🔥", "🍗"], a: "#B94A2A", b: "#5C200F" },
  { m: ["combo", "thali"],             e: ["🍱", "🍛", "🥗"], a: "#BC8C30", b: "#6A480D" },
  { m: ["starter", "appetizer"],       e: ["🍢", "🥟", "🌶️"], a: "#D6742A", b: "#7E3A0C" },
  { m: ["side", "extra"],              e: ["🍟", "🥗", "🧂"], a: "#628F3C", b: "#335219" }
];
const CAT_ART_DEFAULT = { e: ["🍽️", "✨", "🥢"], a: "#2A6F5C", b: "#10352B" };
function catArt(name) {
  const n = String(name || "").toLowerCase();
  // short keywords match at the start of a word only (so "tea" doesn't match "steak")
  const hit = (k) => k.length <= 4 ? new RegExp("\\b" + k.replace(/[-]/g, "\\-")).test(n) : n.includes(k);
  return CAT_ART.find(x => x.m.some(hit)) || CAT_ART_DEFAULT;
}
function catSlug(name) {
  return String(name || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const catPhotoOk = new Set(), catPhotoBad = new Set();
function applyCatPhoto(tile, name) {
  const slug = catSlug(name), url = `img/categories/${slug}.jpg`;
  const show = () => { tile.style.setProperty("--photo", `url("${url}")`); tile.classList.add("has-photo"); };
  if (catPhotoOk.has(slug)) { show(); return; }
  if (catPhotoBad.has(slug)) return;
  const img = new Image();
  img.onload = () => { catPhotoOk.add(slug); show(); };
  img.onerror = () => { catPhotoBad.add(slug); };
  img.src = url;
}

// ===================== HELPERS =====================
const $ = (id) => document.getElementById(id);

// Wire up the Hindi/English toggle buttons now that $ exists.
if ($("kdsLangToggle")) $("kdsLangToggle").onclick = toggleStaffLang;
if ($("waiterLangToggle")) $("waiterLangToggle").onclick = toggleStaffLang;
setStaffLang(staffLang); // sync button label on load

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateStrOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function initialsOf(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "?";
}

// ===================== FULLSCREEN KIOSK MODE =====================
// One tap on load takes the browser into true Fullscreen API mode, which is
// the only web-available way to hide both the browser's own tab/URL bar and
// the Windows taskbar at once. Pressing ESC is intercepted by the browser
// itself to exit fullscreen (we can't and shouldn't override that — it's the
// user's safety valve) — we just detect the exit and offer a one-tap way
// back in via the floating ⛶ button.
function requestKioskFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) return req.call(el).catch(() => {});
  return Promise.resolve();
}

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

$("fsEnterBtn").onclick = async () => {
  await requestKioskFullscreen();
  $("fsGate").classList.add("hidden");
};
$("fsSkipBtn").onclick = () => {
  $("fsGate").classList.add("hidden");
};
$("fsReenterBtn").onclick = async () => {
  await requestKioskFullscreen();
};

["fullscreenchange", "webkitfullscreenchange", "msfullscreenchange"].forEach(evt => {
  document.addEventListener(evt, () => {
    // Whenever the user leaves fullscreen (ESC, alt-tab losing it, etc.) show
    // the small re-launch button; hide it again once they're back in.
    $("fsReenterBtn").classList.toggle("hidden", isFullscreenActive());
  });
});
const money = (n) => "₹" + (Math.round(n * 100) / 100).toFixed(2);

// Escapes text that came from outside the restaurant's own control before it
// is ever placed into innerHTML — customer names/phones typed on the public
// QR ordering page, and the table name that comes straight from that page's
// URL. Without this, anyone can type HTML/script as their "name" on the
// public order form and have it execute inside this authenticated staff
// dashboard the moment the order appears (stored XSS). Always wrap
// customer-supplied text in this before interpolating into a template.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
const uid4 = () => Math.random().toString(36).slice(2, 8);
// Add-ons are stored as plain name strings, but older orders (or the QR
// customer-ordering page, before this fix) may have saved them as
// {name, price} objects instead — this normalizes either shape into text
// so bills/KOTs never print "[object Object]".
function addonNames(addons) {
  return (addons || []).map(a => (typeof a === "string" ? a : (a?.name || ""))).filter(Boolean).join(", ");
}

function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add("hidden"), ms);
}

// Natural sort so tables read 1, 2, 3 … 10 instead of 1, 10, 2 (plain string sort)
function naturalSort(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

// ===== In-house confirm / prompt modal (replaces window.confirm / window.prompt) =====
function showConfirm(msg, { title = "Are you sure?", danger = false, okLabel = "Confirm" } = {}) {
  return new Promise((resolve) => {
    const modal = $("confirmModal");
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    $("confirmInput").classList.add("hidden");
    const okBtn = $("confirmOkBtn");
    okBtn.textContent = okLabel;
    okBtn.classList.toggle("cf-danger", danger);
    modal.classList.remove("hidden");
    const cleanup = (result) => {
      modal.classList.add("hidden");
      okBtn.onclick = null; $("confirmCancelBtn").onclick = null;
      resolve(result);
    };
    okBtn.onclick = () => cleanup(true);
    $("confirmCancelBtn").onclick = () => cleanup(false);
  });
}

function showPrompt(msg, { title = "Enter a value", placeholder = "", defaultValue = "" } = {}) {
  return new Promise((resolve) => {
    const modal = $("confirmModal");
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    const input = $("confirmInput");
    input.classList.remove("hidden");
    input.placeholder = placeholder;
    input.value = defaultValue;
    const okBtn = $("confirmOkBtn");
    okBtn.textContent = "OK";
    okBtn.classList.remove("cf-danger");
    modal.classList.remove("hidden");
    setTimeout(() => input.focus(), 30);
    const cleanup = (result) => {
      modal.classList.add("hidden");
      okBtn.onclick = null; $("confirmCancelBtn").onclick = null; input.onkeydown = null;
      resolve(result);
    };
    okBtn.onclick = () => cleanup(input.value.trim() || null);
    $("confirmCancelBtn").onclick = () => cleanup(null);
    input.onkeydown = (e) => { if (e.key === "Enter") cleanup(input.value.trim() || null); };
  });
}

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const view = $("view-" + name);
  if (view) view.classList.add("active");
  const navBtn = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add("active");
  const titleMap = { dashboard: "Dashboard", tables: "Tables & Orders", order: activeTable?.name || "Order", menu: "Menu Builder", kds: "Kitchen Display", reservations: "Reservations", qrorder: "QR Table Ordering", expenses: "Expenses & Cash", sales: "Sales Summary", bills: "Bill History", staff: "Staff Management", settings: "Settings" };
  if ($("topbarTitle")) $("topbarTitle").textContent = titleMap[name] || "Sip & Scoop Cafe POS";
  if (notifiedTabs.has(name)) { notifiedTabs.delete(name); renderNavDots(); }
  closeSidebar();
  if ($("orderCartPanel")) $("orderCartPanel").classList.remove("open");
  if (name === "kds") renderKds();
  if (name === "reservations") renderReservationsView();
  if (name === "qrorder") renderQrOrderingView();
  if (name === "expenses") renderExpensesView();
  if (name === "sales") renderSalesSummary();
  if (name === "staff") renderStaffView();
}

// ===================== MOBILE NAV / DRAWER =====================
function openSidebar() { $("sidebar").classList.add("open"); $("sidebarOverlay").classList.add("show"); }
function closeSidebar() { $("sidebar").classList.remove("open"); $("sidebarOverlay").classList.remove("show"); }
$("hamburgerBtn").onclick = openSidebar;
$("sidebarCloseBtn").onclick = closeSidebar;
$("sidebarOverlay").onclick = closeSidebar;

function openCartDrawer() { $("orderCartPanel").classList.add("open"); }
function closeCartDrawer() { $("orderCartPanel").classList.remove("open"); }
$("mobileCartBar").onclick = openCartDrawer;
$("cartCloseBtn").onclick = closeCartDrawer;

// ===================== AUTH =====================
$("showSignup").onclick = () => { $("loginForm").classList.add("hidden"); $("signupForm").classList.remove("hidden"); };
$("showLogin").onclick = () => { $("signupForm").classList.add("hidden"); $("loginForm").classList.remove("hidden"); };

function authErr(msg) {
  const e = $("authError");
  e.textContent = msg;
  e.classList.remove("hidden");
}

async function syncPublicRestaurantInfo(uid, data) {
  try {
    await setDoc(doc(db, "restaurants", uid, "public", "info"), {
      name: data.name || "",
      qrOrderingEnabled: !!data.qrOrderingEnabled
    }, { merge: true });
  } catch (err) {
    // Keep the staff POS usable if public QR rules are not configured yet.
    console.warn("Could not sync public QR restaurant info", err);
  }
}

$("signupBtn").onclick = async () => {
  const name = $("suRestoName").value.trim();
  const email = $("suEmail").value.trim();
  const pass = $("suPassword").value;
  if (!name || !email || pass.length < 6) { authErr("Fill all fields — password needs 6+ characters."); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "restaurants", cred.user.uid), {
      name, address: "", phone: "", gstin: "",
      cgstPct: 2.5, sgstPct: 2.5, footer: "Thank you, visit again!",
      ownerEmail: email, createdAt: serverTimestamp()
    });
    await syncPublicRestaurantInfo(cred.user.uid, { name, qrOrderingEnabled: false });
  } catch (err) {
    authErr(err.message.replace("Firebase: ", ""));
  }
};

$("loginBtn").onclick = async () => {
  const email = $("loginEmail").value.trim();
  const pass = $("loginPassword").value;
  if (!email || !pass) { authErr("Enter email and password."); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    authErr(err.message.replace("Firebase: ", ""));
  }
};

$("logoutBtn").onclick = () => { if (REQUIRE_LOGIN) signOut(auth); };

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    restoId = user.uid;
    let snap = await getDoc(doc(db, "restaurants", restoId));
    if (!snap.exists() && !REQUIRE_LOGIN) {
      // First launch of a fresh (anonymous) test session — create a blank
      // restaurant record the same way the normal sign-up flow would.
      await setDoc(doc(db, "restaurants", restoId), {
        name: "My Café (Test)", address: "", phone: "", gstin: "",
        cgstPct: 2.5, sgstPct: 2.5, footer: "Thank you, visit again!",
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "restaurants", restoId, "public", "info"), { name: "My Café (Test)", qrOrderingEnabled: false });
      snap = await getDoc(doc(db, "restaurants", restoId));
    }
    restoData = snap.exists() ? snap.data() : {};
    if (snap.exists()) await syncPublicRestaurantInfo(restoId, restoData);
    $("authScreen").classList.add("hidden");
    $("appShell").classList.remove("hidden");
    $("sbRestoName").textContent = restoData.name || "Your restaurant";
    $("logoutBtn").classList.toggle("hidden", !REQUIRE_LOGIN);
    populateSettings();
    applyDarkKitchenModeUI();
    attachListeners();
    renderDashboardDate();
  } else if (REQUIRE_LOGIN) {
    currentUser = null; restoId = null;
    if (unsubTables) unsubTables();
    if (unsubMenu) unsubMenu();
    if (unsubBills) unsubBills();
    if (unsubOpenOrders) unsubOpenOrders();
    if (unsubStock) unsubStock();
    if (unsubStaff) unsubStaff();
    if (unsubTodayAttendance) unsubTodayAttendance();
    if (unsubExpenses) unsubExpenses();
    if (unsubReservations) unsubReservations();
    if (unsubWaitlist) unsubWaitlist();
    if (unsubCustomerOrders) unsubCustomerOrders();
    if (unsubWaiterCalls) unsubWaiterCalls();
    setStaffUnlocked(false); // sign-out always re-locks the staff area
    if (unsubRangeAttendance) unsubRangeAttendance();
    $("appShell").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
  } else {
    // Test mode, signed out — sign back in anonymously right away instead
    // of showing the login screen.
    signInAnonymously(auth).catch((e) => {
      console.error("Anonymous sign-in failed", e);
      authErr("Couldn't start a test session: " + e.message.replace("Firebase: ", ""));
      $("authScreen").classList.remove("hidden");
    });
  }
});

// ===================== NAV =====================
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.onclick = () => showView(btn.dataset.view);
});

// ===================== FIRESTORE LISTENERS =====================
function attachListeners() {
  const tablesRef = collection(db, "restaurants", restoId, "tables");
  // no orderBy here — Firestore sorts strings lexicographically (1,10,2…); we
  // natural-sort client-side instead so tables read 1, 2, 3 … 10.
  unsubTables = onSnapshot(tablesRef, (snap) => {
    tablesCache = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => naturalSort(a.name, b.name));
    renderTables();
    renderDashboardStats();
    renderDashboardFloorStrip();
  });

  const menuRef = collection(db, "restaurants", restoId, "menu");
  publicMenuChecked = false; publicMenuSig = null;
  unsubMenu = onSnapshot(menuRef, (snap) => {
    menuCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMenuBuilder();
    if ($("view-order").classList.contains("active")) renderMenuPicker();
    syncPublicMenu(snap);
  });

  const billsRef = collection(db, "restaurants", restoId, "bills");
  billsWindowStart = new Date(); billsWindowStart.setHours(0, 0, 0, 0); billsWindowStart.setDate(billsWindowStart.getDate() - LIVE_BILL_DAYS);
  olderBillsCache = []; olderLoadedFrom = null; olderSearchResults = []; olderState = null;
  unsubBills = onSnapshot(query(billsRef, where("createdAt", ">=", Timestamp.fromDate(billsWindowStart)), orderBy("createdAt", "desc")), (snap) => {
    billsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBillHistory();
    renderDashboardStats();
  });


  // Drives seat-level occupancy: which seat letters are taken, on which
  // table, and by which running order — recomputed live so two staff members
  // on two phones never double-book the same chair.
  const ordersRef = collection(db, "restaurants", restoId, "orders");
  unsubOpenOrders = onSnapshot(query(ordersRef, where("status", "==", "open")), (snap) => {
    const prevIds = new Set(openOrdersCache.filter(o => (o.kitchenStatus || "new") === "new").map(o => o.id));
    openOrdersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const hasNewArrival = openOrdersCache.some(o => (o.kitchenStatus || "new") === "new" && !prevIds.has(o.id));
    renderTables();
    renderDashboardStats();
    renderDashboardFloorStrip();
    renderDashboardKdsQueue();
    if (seatPickerTable) renderSeatPicker();
    if ($("view-kds").classList.contains("active")) renderKds();
    if (hasNewArrival && kdsInitialLoadDone) { playNotifSound("kds"); notifyTab("kds"); }
    kdsInitialLoadDone = true;
    refreshAlerts();
  });

  const staffRef = collection(db, "restaurants", restoId, "staff");
  unsubStaff = onSnapshot(staffRef, (snap) => {
    staffCache = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (isStaffUnlocked() && $("view-staff")?.classList.contains("active")) renderStaffGrid();
    renderDashboardStaffDuty();
  });

  const attRef = collection(db, "restaurants", restoId, "attendance");
  unsubTodayAttendance = onSnapshot(query(attRef, where("date", "==", todayStr())), (snap) => {
    todayAttendanceCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (isStaffUnlocked() && $("view-staff")?.classList.contains("active")) renderStaffGrid();
    renderDashboardStaffDuty();
  });
  // this month + the last 7 days (a single-field range query, so no extra index is needed)
  const rangeStart = new Date(); rangeStart.setDate(rangeStart.getDate() - 7);
  const monthFirst = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  unsubRangeAttendance = onSnapshot(query(attRef, where("date", ">=", dateStrOf(rangeStart < monthFirst ? rangeStart : monthFirst))), (snap) => {
    staffRangeAttCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (isStaffUnlocked() && $("view-staff")?.classList.contains("active")) renderStaffGrid();
  });

  const expRef = collection(db, "restaurants", restoId, "expenses");
  unsubExpenses = onSnapshot(query(expRef, orderBy("createdAt", "desc")), (snap) => {
    expensesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if ($("view-expenses").classList.contains("active")) renderExpensesView();
  });

  const resRef = collection(db, "restaurants", restoId, "reservations");
  unsubReservations = onSnapshot(resRef, (snap) => {
    reservationsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if ($("view-reservations").classList.contains("active")) renderReservationsView();
    renderDashboardReservations(); renderDashboardLive();
  });

  const wlRef = collection(db, "restaurants", restoId, "waitlist");
  unsubWaitlist = onSnapshot(query(wlRef, where("status", "==", "waiting")), (snap) => {
    waitlistCache = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    if ($("view-reservations").classList.contains("active")) renderReservationsView();
  });

  const coRef = collection(db, "restaurants", restoId, "customerOrders");
  unsubCustomerOrders = onSnapshot(query(coRef, where("status", "==", "pending")), (snap) => {
    const prevIds = new Set(customerOrdersCache.map(o => o.id));
    customerOrdersCache = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    renderDashboardLive();
    const hasNewArrival = customerOrdersCache.some(o => !prevIds.has(o.id));
    if ($("view-qrorder").classList.contains("active")) renderQrOrderingView();
    renderDashboardKdsQueue();
    if (hasNewArrival && customerOrdersInitialLoadDone) { playNotifSound("qrorder"); notifyTab("qrorder"); }
    customerOrdersInitialLoadDone = true;
    refreshAlerts();
  });

  // "Call waiter" requests customers send from the QR ordering page.
  const wcRef = collection(db, "restaurants", restoId, "waiterCalls");
  unsubWaiterCalls = onSnapshot(query(wcRef, where("status", "==", "pending")), (snap) => {
    const prevIds = new Set(waiterCallsCache.map(o => o.id));
    waiterCallsCache = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    renderDashboardLive();
    const hasNewArrival = waiterCallsCache.some(o => !prevIds.has(o.id));
    if ($("view-qrorder").classList.contains("active")) renderQrOrderingView();
    if (hasNewArrival && waiterCallsInitialLoadDone) { playNotifSound("waiter"); notifyTab("qrorder"); }
    waiterCallsInitialLoadDone = true;
    refreshAlerts();
  });
}

// ===================== DASHBOARD =====================
function renderDashboardDate() {
  const now = new Date();
  $("dashDate").textContent = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const name = (restoData && restoData.name) ? `, ${restoData.name.split(" ")[0]}` : "";
  $("dashGreeting").textContent = `${part}${name}`;
}

function billsOnDate(dateObj) {
  const ds = dateObj.toDateString();
  return billsCache.filter(b => b.createdAt && b.createdAt.toDate && b.createdAt.toDate().toDateString() === ds);
}

// ---- small helpers used only by the dashboard ----
const dxBillDate = (b) => (b.createdAt && b.createdAt.toDate) ? b.createdAt.toDate() : null;
const dxShort = (n) => n >= 100000 ? "₹" + (n / 100000).toFixed(1).replace(/\.0$/, "") + "L"
  : n >= 1000 ? "₹" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : "₹" + Math.round(n);
const dxHour12 = (h) => { const x = h % 12 || 12; return x + (h < 12 ? "a" : "p"); };
const dxClock = (d) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dxPct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;

// smooth line through points (Catmull-Rom → cubic Bézier), clamped so it never dips under the baseline
function dxSmoothPath(pts, yMin, yMax) {
  if (pts.length < 2) return "";
  const cl = (v) => Math.max(yMin, Math.min(yMax, v));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = cl(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = cl(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// Tables genuinely "in service": the table still exists on the floor AND at least
// one of its seats is taken by an open order. This is the same rule the Tables
// board uses, so the dashboard can never disagree with it. Stray open orders
// (no seats, or pointing at a table that no longer exists) are ignored.
function tablesInServiceCount() {
  const live = new Set(tablesCache.map(t => t.id));
  const used = new Set();
  openOrdersCache.forEach(o => {
    if (o.tableId && live.has(o.tableId) && (o.seatLabels || []).length) used.add(o.tableId);
  });
  return used.size;
}

function renderDashboardStats() {
  const today = new Date();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const todaysBills = billsOnDate(today);
  const yBills = billsOnDate(yest);
  const revenue = todaysBills.reduce((s, b) => s + (b.total || 0), 0);
  const yRev = yBills.reduce((s, b) => s + (b.total || 0), 0);
  // fair comparison: what yesterday had taken by this same time of day
  const sameMoment = today.getTime() - 24 * 3600 * 1000;
  const ySoFar = yBills.reduce((s, b) => { const d = dxBillDate(b); return s + (d && d.getTime() <= sameMoment ? (b.total || 0) : 0); }, 0);
  const openTableCount = tablesInServiceCount();
  const itemsSold = todaysBills.reduce((s, b) => s + (b.items || []).reduce((q, it) => q + (it.qty || 0), 0), 0);

  renderDashboardDate();
  $("statRevenue").textContent = money(revenue);
  $("statBills").textContent = todaysBills.length;
  $("statAvgBill").textContent = money(todaysBills.length ? revenue / todaysBills.length : 0);
  $("statOpenTables").textContent = openTableCount;
  $("statBillsSub").textContent = itemsSold ? `${itemsSold} item${itemsSold === 1 ? "" : "s"} sold` : "Completed today";
  $("statTablesSub").textContent = tablesCache.length ? `of ${tablesCache.length} table${tablesCache.length === 1 ? "" : "s"}` : "Currently in service";

  const dEl = $("statRevDelta");
  if (ySoFar > 0) {
    const pct = Math.round((revenue - ySoFar) / ySoFar * 100);
    dEl.className = "dx-delta " + (pct > 0 ? "up" : pct < 0 ? "down" : "flat");
    dEl.textContent = pct === 0 ? "Level with yesterday" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs this time yesterday`;
  } else if (revenue > 0) {
    dEl.className = "dx-delta up"; dEl.textContent = "▲ Ahead of yesterday";
  } else {
    dEl.className = "dx-delta flat"; dEl.textContent = "Service just started";
  }
  $("statRevSub").textContent = yRev > 0 ? `Yesterday closed at ${money(yRev)}` : "Total billed today";

  renderDashboardTopItems(todaysBills);
  renderDashboardHourChart(todaysBills, revenue, yBills);
  renderDashboardWeek();
  renderDashboardPayMix(todaysBills);
  renderDashboardRecentBills();
  renderDashboardReservations();
  renderDashboardLive();
}

// Cards that can be empty early in the day switch to the last 7 days automatically;
// the Today / 7 days toggle lets staff choose.
const dxRange = { top: null, pay: null };
function dxBillsSince(days) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
  return billsCache.filter(b => { const d = dxBillDate(b); return d && d >= from; });
}
function dxRangeFor(key, todaysBills) {
  const r = dxRange[key] || (todaysBills.length ? "today" : "week");
  const el = $(key === "top" ? "dashTopRange" : "dashPayRange");
  if (el) {
    el.innerHTML = `<button data-r="today" class="${r === "today" ? "on" : ""}">Today</button><button data-r="week" class="${r === "week" ? "on" : ""}">7 days</button>`;
    el.querySelectorAll("button").forEach(b => { b.onclick = () => { dxRange[key] = b.dataset.r; renderDashboardStats(); }; });
  }
  return r;
}

function renderDashboardTopItems(todaysBills) {
  const r = dxRangeFor("top", todaysBills);
  const src = r === "today" ? todaysBills : dxBillsSince(7);
  const qtyByName = {};
  src.forEach(b => (b.items || []).forEach(it => { qtyByName[it.name] = (qtyByName[it.name] || 0) + (it.qty || 0); }));
  const all = Object.entries(qtyByName).sort((a, b) => b[1] - a[1]);
  const top5 = all.slice(0, 5);
  const max = top5.length ? top5[0][1] : 1;
  $("dashTopCount").textContent = all.length ? `${all.length} item${all.length === 1 ? "" : "s"}` : "";
  $("dashTopItems").innerHTML = top5.length
    ? top5.map(([name, qty], idx) => `
      <div class="dx-top-row">
        <span class="dx-rank r${idx + 1}">${idx + 1}</span>
        <div class="dx-top-main">
          <div class="dx-top-name"><b>${escapeHtml(name)}</b><span>${qty} sold</span></div>
          <div class="dx-track"><i style="width:${Math.max(6, Math.round(qty / max * 100))}%"></i></div>
        </div>
      </div>`).join("")
    : `<div class="empty-note">${r === "today" ? "No items sold yet today." : "No sales in the last 7 days."}<br><small>Your best sellers will rank here live.</small></div>`;
}

// ---- hourly takings curve (today) ----
function renderDashboardHourChart(todaysBills, revenue, yBills) {
  const el = $("dashHourChart"), axis = $("dashHourAxis");
  const W = 400, H = 120, padT = 14, padB = 6;
  const byHour = Array(24).fill(0), byHourY = Array(24).fill(0);
  todaysBills.forEach(b => { const d = dxBillDate(b); if (d) byHour[d.getHours()] += (b.total || 0); });
  (yBills || []).forEach(b => { const d = dxBillDate(b); if (d) byHourY[d.getHours()] += (b.total || 0); });
  let lo = 9, hi = 22;
  for (let h = 0; h < 24; h++) if (byHour[h] > 0 || byHourY[h] > 0) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const hours = []; for (let h = lo; h <= hi; h++) hours.push(h);
  const mid = hours[Math.floor(hours.length / 2)];
  axis.innerHTML = `<span>${dxHour12(lo)}</span><span>${dxHour12(mid)}</span><span>${dxHour12(hi)}</span>`;

  const gy = (f) => (padT + f * (H - padT - padB)).toFixed(1);
  const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${gy(f)}" y2="${gy(f)}" class="g"/>`).join("");
  const defs = `<defs><linearGradient id="dxArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B5E4A" stop-opacity=".32"/><stop offset="1" stop-color="#1B5E4A" stop-opacity="0"/></linearGradient></defs>`;
  const base = `<line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="base"/>`;

  const valsT = hours.map(h => byHour[h]), valsY = hours.map(h => byHourY[h]);
  const yTotal = valsY.reduce((a, b) => a + b, 0);
  if (revenue <= 0 && yTotal <= 0) {
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${defs}${grid}${base}</svg>
      <div class="dx-spark-empty"><span>Sales appear here as bills come in</span></div>`;
    return;
  }
  const max = Math.max(...valsT, ...valsY, 1);
  const xOf = (i) => hours.length > 1 ? i / (hours.length - 1) * W : 0;
  const yOf = (v) => padT + (1 - v / max) * (H - padT - padB);

  // yesterday: dashed ghost line over the whole day
  const ptsY = valsY.map((v, i) => [xOf(i), yOf(v)]);
  const ghost = yTotal > 0 ? dxSmoothPath(ptsY, padT, H - padB) : "";

  // today: solid line + glow up to "now"
  const now = new Date(), nowH = now.getHours();
  const endIdx = Math.max(0, Math.min(hours.length - 1, nowH - lo));
  const pts = valsT.slice(0, endIdx + 1).map((v, i) => [xOf(i), yOf(v)]);
  const line = (revenue > 0 && pts.length > 1) ? dxSmoothPath(pts, padT, H - padB) : "";
  const last = pts[pts.length - 1];
  const area = line ? `${line} L${last[0].toFixed(1)},${H} L0,${H} Z` : "";
  const nowPos = (nowH + now.getMinutes() / 60 - lo) / Math.max(1, hi - lo) * 100;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${defs}${grid}${base}
      ${ghost ? `<path d="${ghost}" class="gh"/>` : ""}
      ${area ? `<path d="${area}" fill="url(#dxArea)"/>` : ""}
      ${line ? `<path d="${line}" class="ln"/>` : ""}
    </svg>
    ${nowPos >= 0 && nowPos <= 100 ? `<i class="dx-now" style="left:${nowPos.toFixed(2)}%"><em>Now</em></i>` : ""}
    ${revenue > 0 && last ? `<i class="dx-spark-dot" style="left:${(last[0] / W * 100).toFixed(2)}%;top:${(last[1] / H * 100).toFixed(2)}%"></i>` : ""}
    ${revenue <= 0 ? `<div class="dx-spark-empty tl"><span>Today starts here · dashed = yesterday</span></div>` : ""}`;
}

// ---- last 7 days bars ----
function renderDashboardWeek() {
  const el = $("dashWeekChart");
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ d, key: d.toDateString(), sum: 0, n: 0 }); }
  const byKey = Object.fromEntries(days.map(x => [x.key, x]));
  billsCache.forEach(b => {
    const d = dxBillDate(b); if (!d) return;
    const slot = byKey[d.toDateString()];
    if (slot) { slot.sum += (b.total || 0); slot.n++; }
  });
  const total = days.reduce((s, x) => s + x.sum, 0);
  const count = days.reduce((s, x) => s + x.n, 0);
  const max = Math.max(...days.map(x => x.sum), 1);
  const best = days.reduce((a, x) => x.sum > a.sum ? x : a, days[0]);
  $("dashWeekTotal").textContent = total > 0 ? `${money(total)} total` : "";
  el.innerHTML = days.map((x, i) => `
    <div class="dx-bar ${i === 6 ? "today" : ""} ${x.sum === 0 ? "zero" : ""} ${total > 0 && x === best ? "best" : ""}" title="${x.d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })} · ${money(x.sum)} · ${x.n} bill${x.n === 1 ? "" : "s"}">
      <span class="dx-bar-val">${x.sum > 0 ? dxShort(x.sum) : "–"}</span>
      <div class="dx-bar-col"><i style="height:${x.sum > 0 ? Math.max(8, Math.round(x.sum / max * 100)) : 4}%"></i></div>
      <span class="dx-bar-day">${i === 6 ? "Today" : x.d.toLocaleDateString("en-IN", { weekday: "short" })}</span>
    </div>`).join("");
  $("dashWeekFoot").innerHTML = total > 0
    ? `<div><span>Best day</span><b>${best.d.toLocaleDateString("en-IN", { weekday: "short" })} · ${dxShort(best.sum)}</b></div>
       <div><span>Daily average</span><b>${dxShort(total / 7)}</b></div>
       <div><span>Bills this week</span><b>${count}</b></div>`
    : `<div class="dx-foot-empty">Your weekly rhythm appears here once bills are generated.</div>`;
}

// ---- payment + order-type mix (today) ----
function renderDashboardPayMix(todaysBills) {
  const r = dxRangeFor("pay", todaysBills);
  const src = r === "today" ? todaysBills : dxBillsSince(7);
  const split = { cash: 0, card: 0, upi: 0 };
  const types = { dinein: 0, takeaway: 0, delivery: 0 };
  src.forEach(b => {
    const m = split.hasOwnProperty(b.paymentMode) ? b.paymentMode : "cash";
    split[m] += (b.total || 0);
    const t = b.orderType || "dinein";
    types[t === "dinein" ? "dinein" : t === "takeaway" ? "takeaway" : "delivery"]++;
  });
  const total = split.cash + split.card + split.upi;
  const rows = [["cash", "Cash"], ["card", "Card"], ["upi", "UPI"]];
  const R = 52, C = 2 * Math.PI * R;
  const used = rows.filter(([k]) => split[k] > 0);
  let acc = 0;
  const segs = used.map(([k]) => {
    const len = split[k] / total * C, vis = Math.max(used.length > 1 ? len - 4 : len, 1);
    const c = `<circle class="${k}" cx="70" cy="70" r="${R}" stroke-dasharray="${vis.toFixed(1)} ${(C - vis).toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}"/>`;
    acc += len; return c;
  }).join("");
  $("dashPayMix").innerHTML = `
    <div class="dx-donut">
      <svg viewBox="0 0 140 140"><circle class="trk" cx="70" cy="70" r="${R}"/><g transform="rotate(-90 70 70)">${segs}</g></svg>
      <div class="dx-donut-txt"><b>${dxShort(total)}</b><span>${r === "today" ? "collected today" : "last 7 days"}</span></div>
    </div>
    <div class="dx-paylist">${rows.map(([k, label]) => `
      <div class="dx-payrow"><span class="dx-pdot ${k}"></span><span class="dx-pname">${label}</span><b>${money(split[k])}</b><em>${dxPct(split[k], total)}%</em></div>`).join("")}</div>
    <div class="dx-types">
      <div><b>${types.dinein}</b><span>Dine-in</span></div>
      <div><b>${types.takeaway}</b><span>Takeaway</span></div>
      <div><b>${types.delivery}</b><span>Delivery</span></div>
    </div>`;
}

// ---- recent bills ----
function renderDashboardRecentBills() {
  const el = $("dashRecentBills");
  const list = billsCache.slice(0, 6);
  if (!list.length) { el.innerHTML = `<div class="empty-note">No bills yet.<br><small>Generate your first GST bill from a table.</small></div>`; return; }
  const todayKey = new Date().toDateString();
  el.innerHTML = list.map(b => {
    const d = dxBillDate(b);
    const when = d ? (d.toDateString() === todayKey ? dxClock(d) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " + dxClock(d)) : "";
    const pm = ["cash", "card", "upi"].includes(b.paymentMode) ? b.paymentMode : "cash";
    return `
    <div class="dx-bill" data-bill="${b.id}">
      <span class="dx-bill-no">#${escapeHtml(String(b.billNo ?? "—"))}</span>
      <div class="dx-bill-main"><b>${escapeHtml(b.tableName) || "Takeaway"}</b><small>${when} · ${OT_LABEL[b.orderType || "dinein"] || "Dine-in"}</small></div>
      <span class="dx-pay-tag ${pm}">${pm.toUpperCase()}</span>
      <b class="dx-bill-amt">${money(b.total || 0)}</b>
    </div>`;
  }).join("");
  el.querySelectorAll(".dx-bill").forEach(r => { r.onclick = () => showView("bills"); });
}

// ---- reservations today ----
function renderDashboardReservations() {
  const el = $("dashReservations"); if (!el) return;
  const list = reservationsCache
    .filter(r => r.dateStr === todayStr() && r.status !== "cancelled" && r.status !== "completed")
    .sort((a, b) => (a.timeStr || "").localeCompare(b.timeStr || ""));
  $("dashResCount").textContent = list.length ? `${list.length} booked` : "";
  if (!list.length) { el.innerHTML = `<div class="empty-note">No reservations today.<br><small>Walk-ins welcome.</small></div>`; return; }
  el.innerHTML = list.slice(0, 5).map(r => `
    <div class="dx-res-row">
      <span class="dx-res-time">${escapeHtml(r.timeStr || "--:--")}</span>
      <div class="dx-res-main"><b>${escapeHtml(r.customerName)}</b><small>${r.partySize} guest${r.partySize == 1 ? "" : "s"}${r.tableName ? " · Table " + escapeHtml(r.tableName) : ""}</small></div>
    </div>`).join("") + (list.length > 5 ? `<div class="dx-more">+${list.length - 5} more</div>` : "");
}

// ---- live line + alert chips in the hero ----
function renderDashboardLive() {
  const line = $("dashLiveLine"), chips = $("dashAlerts"); if (!line || !chips) return;
  const tables = tablesInServiceCount();
  const cooking = kdsOrders().filter(o => (o.kitchenStatus || "new") !== "ready").length;
  const bits = [];
  if (tables) bits.push(`${tables} table${tables === 1 ? "" : "s"} in service`);
  if (cooking) bits.push(`${cooking} order${cooking === 1 ? "" : "s"} in the kitchen`);
  line.textContent = bits.length ? bits.join("  ·  ") : "All quiet right now — the floor is ready for guests.";
  const out = [];
  if (waiterCallsCache.length) out.push(`<button class="dx-chip hot" data-go="qrorder"><i></i>${waiterCallsCache.length} waiter call${waiterCallsCache.length === 1 ? "" : "s"}</button>`);
  if (customerOrdersCache.length) out.push(`<button class="dx-chip hot" data-go="qrorder"><i></i>${customerOrdersCache.length} QR order${customerOrdersCache.length === 1 ? "" : "s"} waiting</button>`);
  const resToday = reservationsCache.filter(r => r.dateStr === todayStr() && r.status !== "cancelled" && r.status !== "completed").length;
  if (resToday) out.push(`<button class="dx-chip" data-go="reservations"><i></i>${resToday} reservation${resToday === 1 ? "" : "s"} today</button>`);
  // insight: busiest hour across the last 4 weeks of real bills
  const from = new Date(); from.setDate(from.getDate() - 28);
  const hrs = Array(24).fill(0); let n = 0;
  billsCache.forEach(b => { const d = dxBillDate(b); if (d && d >= from) { hrs[d.getHours()]++; n++; } });
  if (n >= 5) {
    const pk = hrs.indexOf(Math.max(...hrs));
    const lab = (h) => `${h % 12 || 12} ${h % 24 < 12 ? "AM" : "PM"}`;
    out.push(`<span class="dx-chip info"><i></i>Busiest hour: ${lab(pk)} – ${lab(pk + 1)}</span>`);
  }
  chips.innerHTML = out.join("");
  chips.querySelectorAll("[data-go]").forEach(c => { c.onclick = () => showView(c.dataset.go); });
}

// ===================== FLOOR STATUS (dashboard) =====================
function renderDashboardFloorStrip() {
  const el = $("dashFloorStrip");
  const summary = $("dashFloorSummary");
  const ring = $("dashFloorRing");
  if (!tablesCache.length) {
    el.innerHTML = `<div class="empty-note">No tables set up yet — add one from Tables &amp; Orders.</div>`;
    summary.textContent = "";
    ring.innerHTML = "";
    return;
  }
  let free = 0, partial = 0, full = 0, seatsTotal = 0, seatsTaken = 0;
  el.innerHTML = tablesCache.map(t => {
    const letters = seatLettersFor(t);
    const occ = seatOccupancyMap(t.id);
    const occupiedCount = letters.filter(l => occ[l]).length;
    seatsTotal += letters.length; seatsTaken += occupiedCount;
    const state = occupiedCount === 0 ? "free" : (occupiedCount === letters.length ? "full" : "partial");
    if (state === "free") free++; else if (state === "full") full++; else partial++;
    const label = state === "free" ? "Free" : state === "full" ? "Full" : `${occupiedCount}/${letters.length} seats`;
    const pips = letters.map(l => `<i class="${occ[l] ? "on" : ""}"></i>`).join("");
    return `<div class="dx-tbl ${state}" data-table="${t.id}"><div class="dx-tbl-name">${escapeHtml(t.name)}</div><div class="dx-tbl-st">${label}</div><div class="dx-pips">${pips}</div></div>`;
  }).join("");
  summary.textContent = `${free} free · ${partial} partial · ${full} full`;
  const pct = dxPct(seatsTaken, seatsTotal);
  const C = 2 * Math.PI * 44;
  ring.innerHTML = `
    <svg viewBox="0 0 108 108"><circle cx="54" cy="54" r="44" class="trk"/><circle cx="54" cy="54" r="44" class="val" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 54 54)"/></svg>
    <div class="dx-ring-txt"><b>${pct}%</b><span>seats taken</span></div>`;
  el.querySelectorAll("[data-table]").forEach(chip => {
    chip.onclick = () => showView("tables");
  });
}

// ===================== KITCHEN DISPLAY SYSTEM (KDS) =====================
// Every open order carries a kitchenStatus: "new" -> "preparing" -> "ready".
// Tickets move across the board as the kitchen taps them; billing (the
// existing order "status" field) is untouched by this.
function kdsOrders() {
  // kdsCleared tickets stay on the underlying order (so tables/billing still
  // see them) but drop off the KDS board once the kitchen taps "Served".
  return openOrdersCache.filter(o => (o.items || []).length && !o.kdsCleared);
}
function kdsElapsedMins(order) {
  const ts = order.kdsUpdatedAt?.toDate ? order.kdsUpdatedAt.toDate() : (order.createdAt?.toDate ? order.createdAt.toDate() : new Date());
  return Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000));
}
function kdsTicketHtml(order) {
  const mins = kdsElapsedMins(order);
  const urgent = mins >= 15 ? "urgent" : (mins >= 8 ? "warn" : "");
  const status = order.kitchenStatus || "new";
  // Dark-kitchen packaging gate: once a takeaway/delivery/aggregator order
  // is "ready", it must be marked packed before it can be cleared off KDS.
  const needsPacking = status === "ready" && order.orderType && order.orderType !== "dinein" && !order.packed;
  const nextLabel = needsPacking ? "📦 " + t("Mark packed")
    : status === "new" ? t("Start preparing")
    : status === "preparing" ? t("Mark ready")
    : t("Served / Clear");
  const itemsHtml = (order.items || []).map(it => `
    <div class="kds-item-row">
      <span class="kds-item-qty">${it.qty}×</span>
      <span class="kds-item-name">${escapeHtml(it.name)}${it.variant ? ` <em>(${escapeHtml(it.variant)})</em>` : ""}</span>
    </div>
    ${(it.addons && it.addons.length) ? `<div class="kds-item-addons">+ ${it.addons.map(a => escapeHtml(typeof a === "string" ? a : a.name)).join(", ")}</div>` : ""}
    ${it.note ? `<div class="kds-item-note">📝 ${escapeHtml(it.note)}</div>` : ""}
  `).join("");
  return `
  <div class="kds-ticket ${urgent}" data-order-id="${order.id}">
    <div class="kds-ticket-head">
      <span class="kds-ticket-table">${escapeHtml(order.tableName) || "Takeaway"} ${seatLabelsText(order.seatLabels)}</span>
      <span class="kds-ticket-time">${mins}m</span>
    </div>
    ${order.orderType && order.orderType !== "dinein" ? `<div class="kds-order-type-badge">${orderTypeBadge(order.orderType)}${order.packed ? " · 📦 " + t("Ready") : ""}</div>` : ""}
    <div class="kds-ticket-items">${itemsHtml}</div>
    <div class="kds-ticket-actions">
      <button class="kds-next-btn ${needsPacking ? "kds-pack-btn" : ""}" data-order-id="${order.id}" data-status="${status}" data-needs-packing="${needsPacking}">${nextLabel}</button>
    </div>
  </div>`;
}
function renderKds() {
  const orders = kdsOrders();
  const groups = { new: [], preparing: [], ready: [] };
  orders.forEach(o => { groups[o.kitchenStatus || "new"]?.push(o); });
  Object.keys(groups).forEach(k => groups[k].sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)));

  $("kdsColNew").innerHTML = groups.new.length ? groups.new.map(kdsTicketHtml).join("") : `<div class="empty-note">No new tickets</div>`;
  $("kdsColPreparing").innerHTML = groups.preparing.length ? groups.preparing.map(kdsTicketHtml).join("") : `<div class="empty-note">Nothing cooking</div>`;
  $("kdsColReady").innerHTML = groups.ready.length ? groups.ready.map(kdsTicketHtml).join("") : `<div class="empty-note">Nothing ready</div>`;

  $("kdsStatNew").textContent = groups.new.length;
  $("kdsStatPreparing").textContent = groups.preparing.length;
  $("kdsStatReady").textContent = groups.ready.length;
  $("kdsColCountNew").textContent = groups.new.length;
  $("kdsColCountPreparing").textContent = groups.preparing.length;
  $("kdsColCountReady").textContent = groups.ready.length;

  const colHeadNew = document.querySelector('.kds-col[data-status="new"] .kds-col-head span:first-child');
  const colHeadPrep = document.querySelector('.kds-col[data-status="preparing"] .kds-col-head span:first-child');
  const colHeadReady = document.querySelector('.kds-col[data-status="ready"] .kds-col-head span:first-child');
  if (colHeadNew) colHeadNew.textContent = "🆕 " + t("New");
  if (colHeadPrep) colHeadPrep.textContent = "🔥 " + t("Preparing");
  if (colHeadReady) colHeadReady.textContent = "✅ " + t("Ready");

  document.querySelectorAll(".kds-next-btn").forEach(btn => {
    btn.onclick = async () => {
      const orderId = btn.dataset.orderId;
      const cur = btn.dataset.status;
      if (btn.dataset.needsPacking === "true") {
        await updateDoc(doc(db, "restaurants", restoId, "orders", orderId), { packed: true, kdsUpdatedAt: serverTimestamp() });
        return;
      }
      const next = cur === "new" ? "preparing" : (cur === "preparing" ? "ready" : "served");
      if (next === "served") {
        await updateDoc(doc(db, "restaurants", restoId, "orders", orderId), { kitchenStatus: "ready", kdsCleared: true, kdsUpdatedAt: serverTimestamp() });
        syncCustomerOrderStatus(orderId, { kitchenStatus: "ready", kdsCleared: true });
      } else {
        await updateDoc(doc(db, "restaurants", restoId, "orders", orderId), { kitchenStatus: next, kdsUpdatedAt: serverTimestamp() });
        syncCustomerOrderStatus(orderId, { kitchenStatus: next, kdsCleared: false });
      }
    };
  });
}
function renderDashboardKdsQueue() {
  const el = $("dashKdsQueue");
  if (!el) return;
  const active = kdsOrders().filter(o => (o.kitchenStatus || "new") !== "ready" || kdsElapsedMins(o) < 20);
  const cnt = $("dashKdsCount");
  if (cnt) cnt.textContent = active.length ? `${active.length} active` : "";
  if (!active.length) {
    el.innerHTML = `<div class="dx-allgood"><i><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i><b>Kitchen is all caught up.</b><span>New tickets will appear here instantly.</span></div>`;
    return;
  }
  el.innerHTML = active.slice(0, 6).map(o => {
    const status = o.kitchenStatus || "new";
    const label = status === "new" ? "New" : (status === "preparing" ? "Preparing" : "Ready");
    const n = (o.items || []).reduce((s, it) => s + (it.qty || 0), 0);
    return `
    <div class="dx-q-row ${status}">
      <span class="dx-q-dot"></span>
      <div class="dx-q-main"><b>${escapeHtml(o.tableName) || "Takeaway"} ${seatLabelsText(o.seatLabels)}</b><small>${n} item${n === 1 ? "" : "s"}</small></div>
      <span class="dx-q-status ${status}">${label}</span>
      <span class="dx-q-time">${kdsElapsedMins(o)}m</span>
    </div>`;
  }).join("");
}
// ===================== NOTIFICATION SOUND ENGINE =====================
// Every ringtone below is synthesized with the Web Audio API — no audio
// files to host or download, so it works instantly offline and never 404s.
let _notifCtx = null;
function _audioCtx() {
  if (!_notifCtx) _notifCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_notifCtx.state === "suspended") _notifCtx.resume();
  return _notifCtx;
}
function _tone(ctx, start, freq, dur, vol, type = "sine") {
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.frequency.value = freq; osc.type = type;
  osc.connect(gain); gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.start(start); osc.stop(start + dur + 0.02);
}
const RINGTONES = {
  bell: {
    label: "🔔 Bell", play(ctx, t0, vol) {
      // Classic bell strike: fundamental + bright inharmonic overtones that decay quickly.
      [1, 2.01, 3.2, 4.3].forEach((mult, i) => _tone(ctx, t0, 660 * mult, 0.9 - i * 0.15, vol * (1 - i * 0.22), "sine"));
    }
  },
  chime: {
    label: "🎐 Soft chime", play(ctx, t0, vol) {
      [880, 1175].forEach((f, i) => _tone(ctx, t0 + i * 0.15, f, 0.35, vol, "sine"));
    }
  },
  ping: {
    label: "💧 Gentle ping", play(ctx, t0, vol) {
      _tone(ctx, t0, 1046, 0.5, vol * 0.8, "sine");
    }
  },
  urgent: {
    label: "🚨 Urgent alert", play(ctx, t0, vol) {
      [0, 0.18, 0.36].forEach(off => { _tone(ctx, t0 + off, 1400, 0.14, vol, "square"); });
    }
  },
  marimba: {
    label: "🎼 Marimba", play(ctx, t0, vol) {
      [523, 659, 784].forEach((f, i) => _tone(ctx, t0 + i * 0.1, f, 0.4, vol * 0.85, "triangle"));
    }
  },
  none: { label: "🔇 Silent", play() {} }
};
function playRingtone(soundKey, volume = 0.55) {
  const rt = RINGTONES[soundKey] || RINGTONES.bell;
  try { rt.play(_audioCtx(), _audioCtx().currentTime, volume); } catch (e) { /* audio not available — ignore */ }
}
// kind: "kds" | "qrorder" | "waiter". Falls back to the classic chime if
// no per-event setting has ever been saved (keeps old behaviour intact).
function playNotifSound(kind) {
  if (!kdsSoundOn) return;
  const key = notifSoundSettings[kind] || NOTIF_SOUND_DEFAULTS[kind] || "chime";
  alertLastRing = Date.now();
  playRingtone(key, notifVolume());
}
function notifVolume() {
  const v = parseInt(localStorage.getItem("notifVolume") || "55", 10);
  return Math.max(0.05, Math.min(1, v / 100));
}
// Back-compat shim — some older call sites may still reference this name.
function playKdsChime() { playNotifSound("kds"); }

async function saveNotifSoundSettings() {
  localStorage.setItem("notifSoundSettings", JSON.stringify(notifSoundSettings));
  try {
    await setDoc(doc(db, "restaurants", restoId), { notificationSettings: notifSoundSettings }, { merge: true });
    restoData = { ...restoData, notificationSettings: notifSoundSettings };
  } catch (e) { /* offline — localStorage copy above still applies immediately */ }
}
function populateNotificationSettingsUI() {
  if (restoData.notificationSettings) {
    notifSoundSettings = { ...NOTIF_SOUND_DEFAULTS, ...restoData.notificationSettings };
    localStorage.setItem("notifSoundSettings", JSON.stringify(notifSoundSettings));
  }
  const rows = [
    { key: "waiter", label: "🔔 Call waiter", hint: "Plays when a customer taps \u201cCall waiter\u201d on the QR menu." },
    { key: "qrorder", label: "📱 New QR order", hint: "Plays when a customer sends an order from the QR menu." },
    { key: "kds", label: "🍳 New kitchen ticket", hint: "Plays when a new order lands on the Kitchen Display." },
  ];
  const el = $("notifSoundRows");
  if (!el) return;
  el.innerHTML = rows.map(r => `
    <div class="notif-sound-row" data-kind="${r.key}">
      <div class="nsr-info"><div class="nsr-label">${r.label}</div><div class="nsr-hint">${r.hint}</div>
        <label class="nsr-repeat"><input type="checkbox" data-repeat="${r.key}" ${alertRepeatOn(r.key) ? "checked" : ""}> Keep ringing on this device until handled</label></div>
      <div class="nsr-controls">
        <select class="nsr-select" data-kind="${r.key}">
          ${Object.entries(RINGTONES).map(([k, v]) => `<option value="${k}" ${notifSoundSettings[r.key] === k ? "selected" : ""}>${v.label}</option>`).join("")}
        </select>
        <button class="nsr-preview" data-kind="${r.key}" title="Preview">▶ Preview</button>
      </div>
    </div>`).join("");
  el.querySelectorAll(".nsr-select").forEach(sel => {
    sel.onchange = () => {
      notifSoundSettings[sel.dataset.kind] = sel.value;
      saveNotifSoundSettings();
      playRingtone(sel.value, notifVolume());
    };
  });
  el.querySelectorAll("[data-repeat]").forEach(cb => {
    cb.onchange = () => { localStorage.setItem("alertRepeat_" + cb.dataset.repeat, cb.checked ? "on" : "off"); refreshAlerts(); };
  });
  el.querySelectorAll(".nsr-preview").forEach(btn => {
    btn.onclick = () => playRingtone(notifSoundSettings[btn.dataset.kind] || "bell", notifVolume());
  });
  const volEl = $("notifVolumeRange");
  if (volEl) {
    volEl.value = localStorage.getItem("notifVolume") || "55";
    volEl.oninput = () => localStorage.setItem("notifVolume", volEl.value);
    volEl.onchange = () => playRingtone(notifSoundSettings.kds, notifVolume());
  }
  syncSoundToggles();
}
// Two toggles control the same master on/off switch: the quick one on the
// Kitchen Display screen, and the one inside Settings → Notification sounds.
// Keep both in sync in either direction.
function syncSoundToggles() {
  [$("kdsSoundToggle"), $("notifSoundToggle")].forEach(el => { if (el) el.checked = kdsSoundOn; });
}
[["kdsSoundToggle"], ["notifSoundToggle"]].forEach(([id]) => {
  if ($(id)) {
    $(id).onchange = () => {
      kdsSoundOn = $(id).checked;
      localStorage.setItem("kdsSoundOn", kdsSoundOn ? "on" : "off");
      syncSoundToggles();
      refreshAlerts();
    };
  }
});
syncSoundToggles();
setInterval(() => { if ($("view-kds").classList.contains("active")) renderKds(); }, 30000);

// ===================== KEEP-RINGING ALERTS =====================
// A new waiter call, a QR order waiting for approval, or a new kitchen ticket
// keeps this device ringing (and the red bar on screen) until it is HANDLED:
//   waiter call  -> someone taps "Resolved"
//   QR order     -> someone taps "Approve" or "Reject"
//   kitchen KOT  -> the kitchen taps "Start preparing" on the Kitchen screen
// The state is derived from the live data, so it stops by itself the moment
// the last pending item is dealt with -- on every device at once.
const ALERT_KINDS = [
  { key: "waiter", one: "waiter call", many: "waiter calls", view: "qrorder" },
  { key: "qrorder", one: "order to approve", many: "orders to approve", view: "qrorder" },
  { key: "kds", one: "new kitchen ticket", many: "new kitchen tickets", view: "kds" },
];
const ALERT_REPEAT_MS = 3500;
let alertTimer = null, alertMutedUntil = 0, alertTitleBase = null, alertTitleFlip = false;

function alertRepeatOn(kind) { return localStorage.getItem("alertRepeat_" + kind) !== "off"; }
function alertCounts() {
  return {
    waiter: waiterCallsCache.length,
    qrorder: customerOrdersCache.length,
    // a ticket is "new" until the kitchen taps Start preparing
    kds: kdsOrders().filter(o => (o.kitchenStatus || "new") === "new").length,
  };
}
function activeAlerts() {
  const c = alertCounts();
  return ALERT_KINDS.filter(k => c[k.key] > 0 && alertRepeatOn(k.key)).map(k => ({ ...k, n: c[k.key] }));
}
function ringAlerts() {
  if (!kdsSoundOn || Date.now() < alertMutedUntil) return;
  alertLastRing = Date.now();
  // stagger the tones when several kinds are pending so they stay distinguishable
  activeAlerts().forEach((k, i) => setTimeout(() => playRingtone(notifSoundSettings[k.key] || NOTIF_SOUND_DEFAULTS[k.key] || "bell", notifVolume()), i * 900));
  try { if (navigator.vibrate) navigator.vibrate([280, 120, 280]); } catch (e) { /* unsupported */ }
}
function refreshAlerts() {
  const bar = $("alertBar");
  if (!bar) return;
  const active = activeAlerts();
  if (!active.length) {
    bar.classList.add("hidden");
    stopAlertLoop();
    return;
  }
  const muted = Date.now() < alertMutedUntil;
  bar.classList.remove("hidden");
  bar.classList.toggle("muted", muted || !kdsSoundOn);
  $("alertItems").innerHTML = active.map(k =>
    `<button type="button" class="al-chip" data-go="${k.view}"><b>${k.n}</b>${k.n === 1 ? k.one : k.many}</button>`).join("");
  const mb = $("alertMuteBtn");
  if (!kdsSoundOn) mb.textContent = "Sound is off";
  else if (muted) mb.textContent = `Muted · ${Math.max(1, Math.ceil((alertMutedUntil - Date.now()) / 1000))}s · Unmute`;
  else mb.textContent = "Mute 1 min";
  startAlertLoop();
}
function startAlertLoop() {
  if (alertTimer) return;
  if (alertTitleBase === null) alertTitleBase = document.title;
  if (Date.now() - alertLastRing > 1500) ringAlerts(); // pending on load, or no one-shot just played
  alertTimer = setInterval(() => {
    const active = activeAlerts();
    if (!active.length) { refreshAlerts(); return; }
    ringAlerts();
    refreshAlerts(); // keeps the mute countdown fresh
    alertTitleFlip = !alertTitleFlip;
    const total = active.reduce((s, k) => s + k.n, 0);
    document.title = alertTitleFlip ? `🔔 (${total}) Needs attention` : alertTitleBase;
  }, ALERT_REPEAT_MS);
}
function stopAlertLoop() {
  if (alertTimer) { clearInterval(alertTimer); alertTimer = null; }
  if (alertTitleBase !== null) { document.title = alertTitleBase; alertTitleBase = null; }
}
$("alertMuteBtn").onclick = () => {
  if (!kdsSoundOn) { toast("Sound is switched off in Settings → Notification sounds"); return; }
  alertMutedUntil = Date.now() < alertMutedUntil ? 0 : Date.now() + 60000;
  if (!alertMutedUntil) ringAlerts();
  refreshAlerts();
};
$("alertItems").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) showView(b.dataset.go);
});
// Browsers only let a page make sound after the person has tapped something once.
// Warm the audio engine on the first touch/click/key so later alerts can ring.
["pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, () => {
  if (!_notifCtx || _notifCtx.state !== "running") { try { _audioCtx(); } catch (e) { /* no audio */ } }
}, { passive: true }));


// ===================== EXPENSES & CASH REGISTER =====================
let expPeriod = "day";
function expensesInRange(period) {
  const now = new Date();
  return expensesCache.filter(e => {
    if (!e.createdAt?.toDate) return false;
    const d = e.createdAt.toDate();
    if (period === "day") return d.toDateString() === now.toDateString();
    if (period === "week") { const wk = new Date(now); wk.setDate(now.getDate() - 7); return d >= wk; }
    if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return true;
  });
}
function renderExpensesView() {
  const now = new Date();
  const todaysBills = billsOnDate(now);
  const cashSalesToday = todaysBills.filter(b => (b.paymentMode || "cash") === "cash").reduce((s, b) => s + (b.total || 0), 0);
  const todaysExpenses = expensesInRange("day");
  const cashExpensesToday = todaysExpenses.filter(e => e.paymentMode === "cash").reduce((s, e) => s + (e.amount || 0), 0);
  const totalToday = todaysExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalMonth = expensesInRange("month").reduce((s, e) => s + (e.amount || 0), 0);

  $("expStatCashSales").textContent = money(cashSalesToday);
  $("expStatToday").textContent = money(totalToday);
  $("expStatCashInHand").textContent = money(cashSalesToday - cashExpensesToday);
  $("expStatMonth").textContent = money(totalMonth);

  const items = expensesInRange(expPeriod);
  $("expCount").textContent = `${items.length} expense${items.length === 1 ? "" : "s"}`;

  const byCat = {};
  items.forEach(e => { byCat[e.category || "Miscellaneous"] = (byCat[e.category || "Miscellaneous"] || 0) + (e.amount || 0); });
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  $("expCategorySplit").innerHTML = catEntries.length ? catEntries.map(([cat, amt]) => `
    <div class="pay-split-row"><span class="psr-label">${cat}</span><span class="psr-amt">${money(amt)}</span></div>
  `).join("") : `<div class="empty-note">No expenses in this period.</div>`;

  const list = $("expenseList");
  if (!items.length) { list.innerHTML = `<div class="empty-note">No expenses recorded in this period.</div>`; }
  else {
    list.innerHTML = items.map(e => `
      <div class="list-row" data-id="${e.id}">
        <div class="lr-main">
          <div class="lr-title">${escapeHtml(e.description) || escapeHtml(e.category)}</div>
          <div class="lr-sub">${e.category} · ${(e.paymentMode || "cash").toUpperCase()} · ${e.createdAt?.toDate ? e.createdAt.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</div>
        </div>
        <div class="lr-amt">${money(e.amount || 0)}</div>
      </div>`).join("");
    list.querySelectorAll(".list-row").forEach(r => {
      r.onclick = () => openExpenseModal(expensesCache.find(e => e.id === r.dataset.id));
    });
  }
}
document.querySelectorAll("#expPeriodToggle .sp-btn").forEach(b => {
  b.onclick = () => {
    expPeriod = b.dataset.period;
    document.querySelectorAll("#expPeriodToggle .sp-btn").forEach(x => x.classList.toggle("active", x === b));
    renderExpensesView();
  };
});
function openExpenseModal(item) {
  editingExpenseId = item ? item.id : null;
  $("expenseModalTitle").textContent = item ? "Edit expense" : "Add expense";
  $("expDesc").value = item?.description || "";
  $("expAmount").value = item?.amount ?? "";
  $("expCategory").value = item?.category || "Groceries & Ingredients";
  $("expPaymentMode").value = item?.paymentMode || "cash";
  $("deleteExpenseBtn").style.display = item ? "inline-flex" : "none";
  $("expenseModal").classList.remove("hidden");
}
$("addExpenseBtn").onclick = () => openExpenseModal(null);
$("expenseModalClose").onclick = () => $("expenseModal").classList.add("hidden");
$("saveExpenseBtn").onclick = async () => {
  const description = $("expDesc").value.trim();
  const amount = parseFloat($("expAmount").value);
  if (!description) { toast("Enter what this expense was for"); return; }
  if (!amount || amount <= 0) { toast("Enter a valid amount"); return; }
  const data = { description, amount, category: $("expCategory").value, paymentMode: $("expPaymentMode").value };
  if (editingExpenseId) {
    await updateDoc(doc(db, "restaurants", restoId, "expenses", editingExpenseId), data);
  } else {
    data.createdAt = serverTimestamp();
    await addDoc(collection(db, "restaurants", restoId, "expenses"), data);
  }
  $("expenseModal").classList.add("hidden");
  toast("Expense saved");
};
$("deleteExpenseBtn").onclick = async () => {
  if (!editingExpenseId) return;
  const ok = await showConfirm("This can't be undone.", { title: "Delete expense?", danger: true, okLabel: "Delete" });
  if (!ok) return;
  await deleteDoc(doc(db, "restaurants", restoId, "expenses", editingExpenseId));
  $("expenseModal").classList.add("hidden");
  toast("Expense deleted");
};

// ===================== RESERVATIONS & WAITLIST =====================
function populateReservationTableDropdown() {
  const sel = $("resTable");
  sel.innerHTML = `<option value="">Any / not assigned</option>` + tablesCache.map(t => `<option value="${t.name}">${t.name}</option>`).join("");
}
function renderReservationsView() {
  populateReservationTableDropdown();
  const filterDate = $("resDateFilter").value || todayStr();
  if (!$("resDateFilter").value) $("resDateFilter").value = todayStr();

  const todays = reservationsCache.filter(r => r.dateStr === todayStr());
  const now = new Date();
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
  const upcomingWeek = reservationsCache.filter(r => {
    if (!r.dateStr) return false;
    const d = new Date(r.dateStr + "T00:00:00");
    return d >= new Date(now.toDateString()) && d <= weekEnd && r.status !== "cancelled" && r.status !== "completed";
  });
  $("resStatToday").textContent = todays.length;
  $("resStatWaitlist").textContent = waitlistCache.length;
  $("resStatWeek").textContent = upcomingWeek.length;

  // Waitlist
  const wlEl = $("waitlistList");
  if (!waitlistCache.length) { wlEl.innerHTML = `<div class="empty-note">No one on the waitlist right now.</div>`; }
  else {
    wlEl.innerHTML = waitlistCache.map(w => {
      const waitMins = w.createdAt?.toDate ? Math.round((Date.now() - w.createdAt.toDate().getTime()) / 60000) : 0;
      return `
      <div class="list-row wl-row" data-id="${w.id}">
        <div class="lr-main">
          <div class="lr-title">${escapeHtml(w.name)} · ${w.partySize} guest${w.partySize == 1 ? "" : "s"}</div>
          <div class="lr-sub">${escapeHtml(w.phone) || "No phone"} · Waiting ${waitMins}m</div>
        </div>
        <div class="lr-actions">
          <button class="lr-btn" data-act="seat" data-id="${w.id}">Seat now</button>
          <button class="lr-btn lr-danger" data-act="remove" data-id="${w.id}">Remove</button>
        </div>
      </div>`;
    }).join("");
    wlEl.querySelectorAll("[data-act='seat']").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await updateDoc(doc(db, "restaurants", restoId, "waitlist", b.dataset.id), { status: "seated" });
      toast("Marked as seated — head to Tables & Orders to assign a table");
    });
    wlEl.querySelectorAll("[data-act='remove']").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await updateDoc(doc(db, "restaurants", restoId, "waitlist", b.dataset.id), { status: "removed" });
    });
  }

  // Reservations for selected date
  const dayRes = reservationsCache.filter(r => r.dateStr === filterDate).sort((a, b) => (a.timeStr || "").localeCompare(b.timeStr || ""));
  const resEl = $("reservationsList");
  if (!dayRes.length) { resEl.innerHTML = `<div class="empty-note">No reservations for this date.</div>`; }
  else {
    resEl.innerHTML = dayRes.map(r => `
      <div class="list-row" data-id="${r.id}">
        <div class="lr-main">
          <div class="lr-title">${r.timeStr || "--:--"} · ${escapeHtml(r.customerName)} · ${r.partySize} guest${r.partySize == 1 ? "" : "s"}</div>
          <div class="lr-sub">${escapeHtml(r.phone) || "No phone"}${r.tableName ? " · Table " + escapeHtml(r.tableName) : ""}${r.notes ? " · " + escapeHtml(r.notes) : ""}</div>
        </div>
        <span class="res-status-badge ${r.status || "upcoming"}">${(r.status || "upcoming")}</span>
      </div>`).join("");
    resEl.querySelectorAll(".list-row").forEach(row => {
      row.onclick = () => openReservationModal(reservationsCache.find(r => r.id === row.dataset.id));
    });
  }
}
$("resDateFilter").onchange = renderReservationsView;

function openReservationModal(item) {
  editingReservationId = item ? item.id : null;
  $("reservationModalTitle").textContent = item ? "Edit reservation" : "New reservation";
  $("resName").value = item?.customerName || "";
  $("resPhone").value = item?.phone || "";
  $("resPartySize").value = item?.partySize || 2;
  populateReservationTableDropdown();
  $("resTable").value = item?.tableName || "";
  $("resDate").value = item?.dateStr || $("resDateFilter").value || todayStr();
  $("resTime").value = item?.timeStr || "";
  $("resNotes").value = item?.notes || "";
  $("deleteReservationBtn").style.display = item ? "inline-flex" : "none";
  // Cancel/complete only make sense for an existing, still-open booking.
  $("resStatusActions").classList.toggle("hidden", !item || item.status === "cancelled" || item.status === "completed");
  $("reservationModal").classList.remove("hidden");
}
$("addReservationBtn").onclick = () => openReservationModal(null);
$("reservationModalClose").onclick = () => $("reservationModal").classList.add("hidden");
$("resMarkCancelledBtn").onclick = async () => {
  if (!editingReservationId) return;
  await updateDoc(doc(db, "restaurants", restoId, "reservations", editingReservationId), { status: "cancelled" });
  $("reservationModal").classList.add("hidden");
  toast("Reservation cancelled");
};
$("resMarkCompletedBtn").onclick = async () => {
  if (!editingReservationId) return;
  await updateDoc(doc(db, "restaurants", restoId, "reservations", editingReservationId), { status: "completed" });
  $("reservationModal").classList.add("hidden");
  toast("Reservation marked completed");
};
$("saveReservationBtn").onclick = async () => {
  const customerName = $("resName").value.trim();
  const dateStr = $("resDate").value;
  const timeStr = $("resTime").value;
  if (!customerName) { toast("Enter the guest's name"); return; }
  if (!dateStr || !timeStr) { toast("Pick a date and time"); return; }
  const data = {
    customerName, phone: $("resPhone").value.trim(), partySize: Math.max(1, parseInt($("resPartySize").value) || 1),
    tableName: $("resTable").value, dateStr, timeStr, notes: $("resNotes").value.trim()
  };
  if (editingReservationId) {
    // Editing details shouldn't silently reopen a cancelled/completed booking —
    // only touch status here if it isn't set yet.
    const existing = reservationsCache.find(r => r.id === editingReservationId);
    if (!existing?.status) data.status = "upcoming";
    await updateDoc(doc(db, "restaurants", restoId, "reservations", editingReservationId), data);
  } else {
    data.status = "upcoming";
    data.createdAt = serverTimestamp();
    await addDoc(collection(db, "restaurants", restoId, "reservations"), data);
  }
  $("reservationModal").classList.add("hidden");
  toast("Reservation saved");
};
$("deleteReservationBtn").onclick = async () => {
  if (!editingReservationId) return;
  const ok = await showConfirm("This can't be undone.", { title: "Delete reservation?", danger: true, okLabel: "Delete" });
  if (!ok) return;
  await deleteDoc(doc(db, "restaurants", restoId, "reservations", editingReservationId));
  $("reservationModal").classList.add("hidden");
  toast("Reservation deleted");
};

$("addWaitlistBtn").onclick = () => {
  $("wlName").value = ""; $("wlPhone").value = ""; $("wlPartySize").value = 2;
  $("waitlistModal").classList.remove("hidden");
};
$("waitlistModalClose").onclick = () => $("waitlistModal").classList.add("hidden");
$("saveWaitlistBtn").onclick = async () => {
  const name = $("wlName").value.trim();
  if (!name) { toast("Enter the guest's name"); return; }
  await addDoc(collection(db, "restaurants", restoId, "waitlist"), {
    name, phone: $("wlPhone").value.trim(), partySize: parseInt($("wlPartySize").value) || 1,
    status: "waiting", createdAt: serverTimestamp()
  });
  $("waitlistModal").classList.add("hidden");
  toast("Added to waitlist");
};

// ===================== QR TABLE ORDERING =====================
function customerOrderBaseUrl() {
  // order.html is deployed alongside index.html on the same host
  return location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "") + "/order.html";
}
function qrUrlFor(table) {
  return `${customerOrderBaseUrl()}?r=${restoId}&t=${encodeURIComponent(table.name)}`;
}
// Draws a QR at any pixel size off-screen and hands back the canvas.
function qrCanvasFor(url, size) {
  if (!window.QRCode) return null;
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(holder);
  try {
    new QRCode(holder, { text: url, width: size, height: size, colorDark: "#0D1E19", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    return holder.querySelector("canvas");
  } finally { holder.remove(); }
}
// A print-ready sticker: QR + "Table X" + "Scan to order" on white.
function qrStickerDataUrl(table, size = 640) {
  const qr = qrCanvasFor(qrUrlFor(table), size);
  if (!qr) return null;
  const pad = Math.round(size * 0.09), cap = Math.round(size * 0.24);
  const W = size + pad * 2, H = size + pad * 2 + cap;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  x.drawImage(qr, pad, pad, size, size);
  x.fillStyle = "#0D1E19"; x.textAlign = "center";
  x.font = `700 ${Math.round(size * 0.085)}px 'Bricolage Grotesque','Sora',Arial,sans-serif`;
  x.fillText("Table " + table.name, W / 2, pad + size + Math.round(cap * 0.5), W - pad);
  x.fillStyle = "#66726C";
  x.font = `600 ${Math.round(size * 0.048)}px Inter,Arial,sans-serif`;
  x.fillText("Scan to order", W / 2, pad + size + Math.round(cap * 0.82));
  return c.toDataURL("image/png");
}
function downloadDataUrl(url, filename) {
  const a = document.createElement("a");
  a.download = filename; a.href = url;
  document.body.appendChild(a); a.click(); a.remove();
}

let qrGridSig = "";
function renderQrTableGrid() {
  const el = $("qrTableGrid");
  if (!el) return;
  // QR codes are only redrawn when the table list (or link) actually changes,
  // not on every incoming order/call.
  const sig = restoId + "|" + customerOrderBaseUrl() + "|" + tablesCache.map(t => `${t.id}:${t.name}:${t.floor || ""}`).join(",");
  if (sig !== qrGridSig) {
    qrGridSig = sig;
    if (!tablesCache.length) {
      el.innerHTML = `<div class="qx-empty qx-qr-none"><span class="qx-empty-ico">${SQ(SQP.inbox)}</span><b>No tables yet</b><span>Add tables in Tables &amp; Orders first. A QR code is created for each one automatically.</span></div>`;
    } else {
      el.innerHTML = tablesCache.map(tb => `
        <article class="qx-qr" data-id="${tb.id}" data-search="${escapeHtml((tb.name + " " + (tb.floor || "")).toLowerCase())}">
          <div class="qx-qr-code" id="qrbox-${tb.id}"></div>
          <div class="qx-qr-meta"><b>Table ${escapeHtml(tb.name)}</b><small>${escapeHtml(tb.floor || "Scan to order")}</small></div>
          <div class="qx-qr-btns">
            <button type="button" data-qr="dl" title="Download print-ready image">${SQ(SQP.down)}Download</button>
            <button type="button" data-qr="copy" title="Copy link" aria-label="Copy ordering link for table ${escapeHtml(tb.name)}">${SQ(SQP.link)}</button>
            <button type="button" data-qr="open" title="Preview what guests see" aria-label="Preview table ${escapeHtml(tb.name)}">${SQ(SQP.open)}</button>
          </div>
        </article>`).join("");
      tablesCache.forEach(tb => {
        if (window.QRCode) new QRCode($(`qrbox-${tb.id}`), { text: qrUrlFor(tb), width: 150, height: 150, colorDark: "#0D1E19", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      });
    }
  }
  applyQrTableFilter();
}
function applyQrTableFilter() {
  const q = ($("qrTableSearch")?.value || "").trim().toLowerCase();
  document.querySelectorAll("#qrTableGrid .qx-qr").forEach(c => c.classList.toggle("hidden", !!q && !c.dataset.search.includes(q)));
}
$("qrTableSearch").addEventListener("input", applyQrTableFilter);
$("qrTableGrid").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-qr]");
  if (!b) return;
  const tb = tablesCache.find(t => t.id === b.closest(".qx-qr").dataset.id);
  if (!tb) return;
  if (b.dataset.qr === "dl") {
    const url = qrStickerDataUrl(tb, 640);
    if (!url) { toast("QR library didn't load. Check your connection and refresh."); return; }
    downloadDataUrl(url, `QR-Table-${tb.name}.png`);
  } else if (b.dataset.qr === "copy") {
    try { await navigator.clipboard.writeText(qrUrlFor(tb)); toast(`Link for table ${tb.name} copied`); }
    catch (err) { window.prompt("Copy this link:", qrUrlFor(tb)); }
  } else if (b.dataset.qr === "open") {
    window.open(qrUrlFor(tb), "_blank", "noopener");
  }
});
$("qrDownloadAllBtn").onclick = () => {
  if (!tablesCache.length) { toast("Add tables first"); return; }
  toast(`Downloading ${tablesCache.length} QR code${tablesCache.length === 1 ? "" : "s"}…`);
  tablesCache.forEach((tb, i) => setTimeout(() => {
    const url = qrStickerDataUrl(tb, 640);
    if (url) downloadDataUrl(url, `QR-Table-${tb.name}.png`);
  }, i * 450));
};
// Opens a clean sheet with every table's sticker (2 per row) and prints it.
$("qrPrintAllBtn").onclick = () => {
  if (!tablesCache.length) { toast("Add tables first"); return; }
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups for this site to print"); return; }
  const cards = tablesCache.map(tb => {
    const img = qrStickerDataUrl(tb, 420);
    return img ? `<figure><img src="${img}" alt="QR for table ${escapeHtml(tb.name)}"></figure>` : "";
  }).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Table QR codes — ${escapeHtml(restoData?.name || "")}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;padding:18px;font-family:Inter,Arial,sans-serif;color:#0D1E19}
      h1{font-size:15px;margin:0 0 14px;font-weight:600;color:#66726C}
      .g{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
      figure{margin:0;border:1.5px dashed #bbb;border-radius:14px;padding:10px;break-inside:avoid;text-align:center}
      img{width:100%;max-width:340px;height:auto}
      @media print{body{padding:0}h1{display:none}}
    </style></head><body><h1>${escapeHtml(restoData?.name || "Table QR codes")} · cut along the dashed lines</h1><div class="g">${cards}</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script></body></html>`);
  w.document.close();
};

// ---------- live lists ----------
function qrWaitMins(rec) {
  const ms = rec.createdAt?.toDate ? rec.createdAt.toDate().getTime() : Date.now();
  return Math.max(0, Math.floor((Date.now() - ms) / 60000));
}
function qrWaitText(mins) { return mins <= 0 ? t("just now") : mins + t("m ago"); }

function renderQrStats() {
  const on = !!restoData.qrOrderingEnabled;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("qxCallsNum", waiterCallsCache.length);
  set("qxOrdersNum", customerOrdersCache.length);
  set("qxTablesNum", tablesCache.length);
  set("qxStateNum", on ? "Live" : "Off");
  set("qrSwitchState", on ? "Ordering is on" : "Ordering is off");
  $("qxStatCalls")?.classList.toggle("hot", waiterCallsCache.length > 0);
  $("qxStatOrders")?.classList.toggle("warn", customerOrdersCache.length > 0);
  $("qxStatState")?.classList.toggle("live", on);
  $("qxStatState")?.classList.toggle("off", !on);
}

function renderWaiterCallsPanel() {
  const el = $("qrTableRequestsList");
  if (!el) return;
  const cnt = $("qrTableRequestsCount");
  cnt.textContent = waiterCallsCache.length ? `${waiterCallsCache.length} waiting` : "";
  cnt.classList.toggle("hot", waiterCallsCache.length > 0);
  const head = document.querySelector("#qrTableRequestsPanel .qx-card-head h2");
  if (head) head.lastChild.textContent = t("Waiter calls");
  if (!waiterCallsCache.length) {
    el.innerHTML = `<div class="qx-empty"><span class="qx-empty-ico">${SQ(SQP.check)}</span><b>${t("No waiter calls right now.")}</b><span>New calls appear here and ring this device until you resolve them.</span></div>`;
    return;
  }
  el.innerHTML = waiterCallsCache.map(r => `
    <div class="qx-call" data-id="${r.id}">
      <span class="qx-call-ico">${SQ(SQP.bell)}</span>
      <div class="qx-call-main">
        <b>${t("Table")} ${escapeHtml(r.tableName)}${r.floor ? " · " + escapeHtml(r.floor) : ""}${r.seatLabels?.length ? " · " + t("Seat") + " " + seatLabelsText(r.seatLabels) : ""}</b>
        <small>${t("Asked for a waiter")} · ${qrWaitText(qrWaitMins(r))}</small>
      </div>
      <button type="button" class="qx-btn ok" data-act="resolve-waiter" data-id="${r.id}">${SQ(SQP.check)}${t("Resolved")}</button>
    </div>`).join("");
}

function renderQrIncoming() {
  const el = $("qrIncomingList");
  if (!el) return;
  const cnt = $("qrIncomingCount");
  cnt.textContent = customerOrdersCache.length ? `${customerOrdersCache.length} waiting` : "";
  cnt.classList.toggle("hot", customerOrdersCache.length > 0);
  if (!customerOrdersCache.length) {
    el.innerHTML = `<div class="qx-empty"><span class="qx-empty-ico">${SQ(SQP.inbox)}</span><b>${t("No incoming customer orders right now.")}</b><span>${restoData.qrOrderingEnabled ? "When a guest sends an order from their table, it shows up here for you to approve." : "Customer ordering is switched off. Turn it on above so guests can order from the QR code."}</span></div>`;
    return;
  }
  el.innerHTML = customerOrdersCache.map(o => {
    const mins = qrWaitMins(o);
    const state = mins >= 5 ? "overdue" : (mins >= 2 ? "late" : "");
    const items = o.items || [];
    const total = o.total != null ? Number(o.total) : items.reduce((s, i) => s + (Number(i.price ?? i.unitPrice ?? 0) * (Number(i.qty) || 1)), 0);
    const phone = String(o.customerPhone || "").replace(/\D/g, "");
    const lines = items.map(i => {
      const addons = (i.addons || []).map(a => escapeHtml(typeof a === "string" ? a : a.name)).join(", ");
      return `<li><span class="q">${Number(i.qty) || 1}×</span><span>${escapeHtml(i.name)}${i.variant ? ` <em>(${escapeHtml(i.variant)})</em>` : ""}</span>${addons ? `<small>+ ${addons}</small>` : ""}${i.note ? `<small>Note: ${escapeHtml(i.note)}</small>` : ""}</li>`;
    }).join("");
    return `
    <article class="qx-order ${state}" data-id="${o.id}">
      <div class="qx-order-top">
        <span class="qx-tag">${t("Table")} ${escapeHtml(o.tableName)}</span>
        ${o.seatLabels?.length ? `<span class="qx-seat">${t("Seat")} ${seatLabelsText(o.seatLabels)}</span>` : ""}
        <span class="qx-wait">${SQ(SQP.clock)}${qrWaitText(mins)}</span>
      </div>
      <div class="qx-guest"><b>${escapeHtml(o.customerName) || t("Guest")}</b>${phone ? `<a href="tel:+${phoneDigits(phone)}">${SQ(SQP.phone)}${escapeHtml(phone)}</a>` : ""}</div>
      <ul class="qx-lines">${lines}</ul>
      <div class="qx-order-foot">
        <span class="qx-total">${money(total)}</span>
        <button type="button" class="qx-btn no" data-act="reject" data-id="${o.id}">${t("Reject")}</button>
        <button type="button" class="qx-btn ok" data-act="approve" data-id="${o.id}">${SQ(SQP.check)}${t("Approve")}</button>
      </div>
    </article>`;
  }).join("");
}

$("qrIncomingList").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const co = customerOrdersCache.find(o => o.id === b.dataset.id);
  if (!co) return;
  b.disabled = true;
  try {
    if (b.dataset.act === "approve") {
      await approveCustomerOrder(co);
    } else if (b.dataset.act === "reject") {
      const ok = await showConfirm("The guest will see that their order wasn't accepted.", { title: "Reject this order?", danger: true, okLabel: "Reject" });
      if (ok) await updateDoc(doc(db, "restaurants", restoId, "customerOrders", co.id), { status: "rejected" });
    }
  } catch (err) {
    console.error(err);
    toast("Couldn't update that order. Check your connection and try again.");
  }
  b.disabled = false;
});
$("qrTableRequestsList").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act='resolve-waiter']");
  if (!b) return;
  b.disabled = true;
  try { await updateDoc(doc(db, "restaurants", restoId, "waiterCalls", b.dataset.id), { status: "resolved" }); }
  catch (err) { console.error(err); toast("Couldn't resolve that call. Try again."); b.disabled = false; }
});

function renderQrOrderingView() {
  $("qrOrderingEnabledToggle").checked = !!restoData.qrOrderingEnabled;
  renderQrStats();
  renderQrTableGrid();
  renderWaiterCallsPanel();
  renderQrIncoming();
}
// keep "waiting for 3 min" labels fresh while the screen is open
setInterval(() => {
  if ($("view-qrorder")?.classList.contains("active") && (customerOrdersCache.length || waiterCallsCache.length)) {
    renderWaiterCallsPanel(); renderQrIncoming();
  }
}, 20000);

// Mirrors the kitchen status onto every QR order linked to a running order, so the
// customer's phone (order.html) can show Received -> Preparing -> Ready -> Served.
async function syncCustomerOrderStatus(orderId, patch) {
  if (!orderId) return;
  try {
    const snap = await getDocs(query(collection(db, "restaurants", restoId, "customerOrders"), where("orderId", "==", orderId)));
    await Promise.all(snap.docs.map(d => updateDoc(d.ref, { ...patch, statusUpdatedAt: serverTimestamp() })));
  } catch (e) { console.warn("Customer status sync failed", e); toast("⚠️ Customer live status not updated: " + (e.code || e.message)); }
}
async function approveCustomerOrder(co) {
  if (!co) return;
  // find or create the matching table
  let table = tablesCache.find(t => t.name === co.tableName);
  if (!table) { toast("That table no longer exists"); return; }
  const seatLabels = co.seatLabels && co.seatLabels.length ? co.seatLabels : [];
  const seatSuffix = seatLabels.length ? ` Seat ${seatLabelsText(seatLabels)}` : "";
  const ticketLabel = `${table.name}${seatSuffix}`;

  // A QR order should land on the SAME running order as that exact seat,
  // not just any open order on the table — that's what keeps the Tables
  // board and the bill-time seat lookup accurate when a table is split.
  const existing = openOrdersCache.find(o => o.tableId === table.id &&
    seatLabels.length && (o.seatLabels || []).some(s => seatLabels.includes(s)));

  // mark items as already printed since we auto-print the KOT below —
  // avoids the kitchen ticket printing a second time if staff open this
  // order and hit "Save order" later.
  //
  // SECURITY: never trust the price a customer's browser submitted on a
  // QR order — that document is created client-side with no server-side
  // price check (Firestore rules can validate size/shape, not "does this
  // match the real menu price"). A tampered write could otherwise put a
  // fake low price straight into the real bill the moment staff approve
  // it. Instead, re-look-up every item's real price from the trusted menu
  // data staff already have loaded (menuCache), by itemId + variant/addon
  // name, and recompute unitPrice/lineTotal from that — the customer-
  // submitted price is never used for money math, only as a last-resort
  // display fallback if the item was deleted from the menu since ordering.
  let priceMismatchFlagged = false;
  const newItems = co.items.map(i => {
    const qty = Math.max(1, Number(i.qty ?? 1) || 1);
    const menuItem = menuCache.find(m => m.id === i.itemId);
    if (!menuItem) {
      // Item no longer exists on the menu — can't verify, fall back to the
      // submitted price but flag it so staff notice and can double-check.
      priceMismatchFlagged = true;
      const fallbackPrice = Math.max(0, Number(i.price ?? i.unitPrice ?? 0));
      return { ...i, unitPrice: fallbackPrice, lineTotal: fallbackPrice * qty, printed: true };
    }
    let unitPrice = menuItem.basePrice || 0;
    if (i.variant && menuItem.variants?.length) {
      const v = menuItem.variants.find(v => v.name === i.variant);
      unitPrice = v ? v.price : unitPrice;
    }
    if (i.addons?.length && menuItem.addons?.length) {
      unitPrice += i.addons.reduce((sum, addonName) => {
        const a = menuItem.addons.find(a => a.name === addonName);
        return sum + (a ? a.price : 0);
      }, 0);
    }
    return { ...i, name: menuItem.name, unitPrice, lineTotal: unitPrice * qty, printed: true };
  });
  if (priceMismatchFlagged) toast("⚠️ Some items on this order are no longer on your menu — their price couldn't be verified, please double-check the bill.");

  let linkedOrderId = existing ? existing.id : null;
  if (existing) {
    await updateDoc(doc(db, "restaurants", restoId, "orders", existing.id), {
      items: [...existing.items, ...newItems],
      seatLabels: [...new Set([...(existing.seatLabels || []), ...seatLabels])],
      customerName: existing.customerName || co.customerName || "",
      kitchenStatus: "new", kdsUpdatedAt: serverTimestamp(), kdsCleared: false, updatedAt: serverTimestamp()
    });
  } else {
    linkedOrderId = doc(collection(db, "restaurants", restoId, "orders")).id;
    await setDoc(doc(db, "restaurants", restoId, "orders", linkedOrderId), {
      tableId: table.id, tableName: table.name, seatLabels, items: newItems,
      status: "open", orderType: "dinein", paymentMode: "cash",
      customerName: co.customerName || "", customerPhone: co.customerPhone || "",
      kitchenStatus: "new", kdsUpdatedAt: serverTimestamp(), kdsCleared: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  }
  await updateDoc(doc(db, "restaurants", restoId, "customerOrders", co.id), { status: "approved", orderId: linkedOrderId, kitchenStatus: "new", kdsCleared: false, statusUpdatedAt: serverTimestamp() });
  // a repeat order on the same seat pulls the whole ticket back to "new" - keep every linked phone in step
  await syncCustomerOrderStatus(linkedOrderId, { kitchenStatus: "new", kdsCleared: false });
  // auto-print the kitchen ticket the moment the order is approved, before
  // it ever needs a manual "Start preparing" tap on the KDS board
  await printKOT(co.items, ticketLabel);
  toast(`Order sent to kitchen for ${ticketLabel}`);
}
$("qrOrderingEnabledToggle").onchange = async () => {
  const val = $("qrOrderingEnabledToggle").checked;
  await setDoc(doc(db, "restaurants", restoId), { qrOrderingEnabled: val }, { merge: true });
  // Mirrored into the public doc too — see saveSettingsBtn above for why.
  await setDoc(doc(db, "restaurants", restoId, "public", "info"), { qrOrderingEnabled: val }, { merge: true });
  restoData.qrOrderingEnabled = val;
  renderQrStats(); renderQrIncoming();
  toast(val ? "Customer ordering enabled" : "Customer ordering disabled");
};

// ===================== STAFF ON DUTY (dashboard) =====================
function renderDashboardStaffDuty() {
  const el = $("dashStaffDuty");
  if (!staffCache.length) {
    el.innerHTML = `<div class="empty-note">No staff added yet — set them up in Staff Management.</div>`;
    const s0 = $("dashStaffSummary"); if (s0) s0.textContent = "";
    return;
  }
  const statusLabel = { present: "Present", halfday: "Half-day", leave: "On leave", absent: "Absent", none: "Not marked" };
  let present = 0, marked = 0;
  const cards = staffCache.map(s => {
    const rec = todayAttendanceCache.find(a => a.staffId === s.id);
    const status = rec?.status || "none";
    if (status === "present" || status === "halfday") present++;
    if (status !== "none") marked++;
    return `
    <div class="dx-person">
      <div class="dx-avatar ${status}">${initialsOf(s.name)}</div>
      <div class="dx-person-info"><b>${escapeHtml(s.name)}</b><span class="dx-st ${status}">${statusLabel[status]}</span></div>
    </div>`;
  }).join("");
  el.innerHTML = `
    <div class="dx-attend"><div class="dx-attend-bar"><i style="width:${dxPct(marked, staffCache.length)}%"></i></div><span>${marked} of ${staffCache.length} attendance marked today</span></div>
    <div class="dx-staff-grid">${cards}</div>`;
  const sum = $("dashStaffSummary");
  if (sum) sum.textContent = `${present} of ${staffCache.length} in`;
}

$("dashViewBillsBtn").onclick = () => showView("bills");
setInterval(() => {
  if (restoId && $("view-dashboard").classList.contains("active")) { renderDashboardStats(); renderDashboardKdsQueue(); }
}, 60000);

$("dashRecentAllBtn").onclick = () => showView("bills");

document.querySelectorAll("#dashQuickActions [data-qa]").forEach(btn => {
  btn.onclick = () => {
    const action = btn.dataset.qa;
    if (action === "order" || action === "table") {
      showView("tables");
      if (action === "table") $("addTableBtn").click();
    } else {
      showView(action);
    }
  };
});

// ===================== TABLES + SEAT-LEVEL BOOKING =====================
let activeFloor = "All"; // currently selected floor tab on the Tables & Orders grid

$("addTableBtn").onclick = async () => {
  const name = await showPrompt("This is how it'll appear on the floor grid.", { title: "Add a table", placeholder: "e.g. T1, Patio-2" });
  if (!name) return;
  const seatsStr = await showPrompt("How many chairs at this table? (used for seat-wise billing)", { title: "Seats at this table", placeholder: "4", defaultValue: "4" });
  const seats = Math.min(12, Math.max(1, parseInt(seatsStr) || 4));
  const existingFloors = floorList();
  const floorDefault = activeFloor !== "All" ? activeFloor : (existingFloors[0] || "Ground Floor");
  const floor = await showPrompt("e.g. Ground Floor, 1st Floor, Terrace, Patio", { title: "Which floor is this table on?", placeholder: "Ground Floor", defaultValue: floorDefault });
  await addDoc(collection(db, "restaurants", restoId, "tables"), { name: name.trim(), seats, floor: (floor || "Ground Floor").trim(), status: "free", createdAt: serverTimestamp() });
};

$("manageFloorsBtn").onclick = async () => {
  const floors = floorList();
  if (!floors.length) { toast("Add a table first to create a floor."); return; }
  const pick = await showPrompt(`Existing floors: ${floors.join(", ")}. Type the exact floor name you want to rename.`, { title: "Rename a floor", placeholder: floors[0], defaultValue: floors[0] });
  if (!pick) return;
  const match = floors.find(f => f.toLowerCase() === pick.trim().toLowerCase());
  if (!match) { toast("No floor with that exact name found."); return; }
  const renamed = await showPrompt(`All tables on "${match}" will move to the new name.`, { title: "New floor name", placeholder: "e.g. 2nd Floor", defaultValue: match });
  if (!renamed || renamed.trim() === match) return;
  const affected = tablesCache.filter(t => (t.floor || "Ground Floor") === match);
  await Promise.all(affected.map(t => updateDoc(doc(db, "restaurants", restoId, "tables", t.id), { floor: renamed.trim() })));
  if (activeFloor === match) activeFloor = renamed.trim();
  toast(`Renamed "${match}" to "${renamed.trim()}" on ${affected.length} table${affected.length === 1 ? "" : "s"}.`);
};

function floorList() {
  const set = new Set(tablesCache.map(t => t.floor || "Ground Floor"));
  return [...set].sort(naturalSort);
}

const OT_LABEL = { dinein: "Dine-in", takeaway: "Takeaway", delivery: "Delivery", swiggy: "Swiggy", zomato: "Zomato" };
function orderTypeBadge(ot) {
  const t = ot || "dinein";
  return `<span class="badge badge-${t}">${OT_LABEL[t]}</span>`;
}

// Seat letters a, b, c, d… up to the table's capacity.
function seatLettersFor(table) {
  const n = table.seats || 4;
  return "abcdefghijkl".slice(0, n).split("");
}
function ordersForTable(tableId) {
  return openOrdersCache.filter(o => o.tableId === tableId);
}
// Map of seat-letter -> the open order currently occupying it (undefined if free)
function seatOccupancyMap(tableId) {
  const map = {};
  ordersForTable(tableId).forEach(o => (o.seatLabels || []).forEach(s => { map[s] = o; }));
  return map;
}
function seatLabelsText(seatLabels) {
  return (seatLabels || []).map(s => s.toUpperCase()).join(", ");
}

function renderFloorTabs() {
  const wrap = $("floorTabs");
  const floors = floorList();
  if (floors.length <= 1) { wrap.innerHTML = ""; return; }
  if (!floors.includes(activeFloor) && activeFloor !== "All") activeFloor = "All";
  wrap.innerHTML = ["All", ...floors].map(f => `
    <button class="floor-tab ${f === activeFloor ? "active" : ""}" data-floor="${f}">${f === "All" ? "All floors" : f}</button>`).join("");
  wrap.querySelectorAll("[data-floor]").forEach(b => {
    b.onclick = () => { activeFloor = b.dataset.floor; renderTables(); };
  });
}

// Renders a small top-down illustration of the table itself with a chair
// placed around it for every seat — filled/pulsing when occupied — instead
// of a plain stat card, so the floor grid reads like an actual restaurant
// layout at a glance.
function tableSVG(letters, occ, state) {
  const n = letters.length;
  const cx = 60, cy = 60, orbit = 40, chairR = 8.5;
  const tableRx = n <= 4 ? 24 : 29;
  const chairs = letters.map((l, i) => {
    const angle = (360 / n) * i - 90;
    const rad = angle * Math.PI / 180;
    const x = (cx + orbit * Math.cos(rad)).toFixed(1);
    const y = (cy + orbit * Math.sin(rad)).toFixed(1);
    return `<circle class="chair ${occ[l] ? "taken" : "free"}" cx="${x}" cy="${y}" r="${chairR}"></circle>`;
  }).join("");
  return `
  <svg class="table-svg" viewBox="0 0 120 120">
    ${state !== "free" ? `<circle class="table-pulse-ring" cx="${cx}" cy="${cy}" r="${tableRx + 4}"></circle>` : ""}
    <circle class="table-surface" cx="${cx}" cy="${cy}" r="${tableRx}"></circle>
    <circle class="table-surface-inner" cx="${cx}" cy="${cy}" r="${tableRx - 7}"></circle>
    ${chairs}
  </svg>`;
}

function tableCardHtml(t, idx = 0) {
  const letters = seatLettersFor(t);
  const occ = seatOccupancyMap(t.id);
  const occupiedCount = letters.filter(l => occ[l]).length;
  const runningTotal = ordersForTable(t.id).reduce((s, o) => s + (o.items || []).reduce((s2, i) => s2 + i.lineTotal, 0), 0);
  const state = occupiedCount === 0 ? "free" : (occupiedCount === letters.length ? "full" : "partial");
  return `
    <div class="table-card ${state !== "free" ? "occupied" : ""} tc-${state}" data-id="${t.id}" style="animation-delay:${Math.min(idx, 12) * 30}ms">
      <button class="tc-del" data-del="${t.id}" title="Remove table">✕</button>
      ${tableSVG(letters, occ, state)}
      <div class="tc-name">${escapeHtml(t.name)}</div>
      <div class="tc-status tc-status-${state}">${state === "free" ? "Free" : state === "full" ? "Occupied" : `${occupiedCount}/${letters.length} seated`}</div>
      ${runningTotal ? `<div class="tc-amt">${money(runningTotal)} running</div>` : ""}
    </div>`;
}

function renderTables() {
  renderFloorTabs();
  const grid = $("tableGrid");
  if (!tablesCache.length) { grid.innerHTML = `<div class="empty-note">No tables yet. Click "+ Add table" to set up your floor.</div>`; return; }

  if (activeFloor === "All") {
    const floors = floorList();
    grid.className = floors.length > 1 ? "table-grid-sections" : "table-grid";
    grid.innerHTML = floors.map(f => {
      const tables = tablesCache.filter(t => (t.floor || "Ground Floor") === f);
      if (floors.length <= 1) return tables.map((t, i) => tableCardHtml(t, i)).join("");
      return `
      <div class="floor-section">
        <div class="floor-section-title">${f} <span class="floor-section-count">${tables.length} table${tables.length === 1 ? "" : "s"}</span></div>
        <div class="table-grid">${tables.map((t, i) => tableCardHtml(t, i)).join("")}</div>
      </div>`;
    }).join("");
  } else {
    grid.className = "table-grid";
    const tables = tablesCache.filter(t => (t.floor || "Ground Floor") === activeFloor);
    grid.innerHTML = tables.map((t, i) => tableCardHtml(t, i)).join("") || `<div class="empty-note">No tables on this floor yet.</div>`;
  }

  grid.querySelectorAll(".table-card").forEach(card => {
    card.onclick = (e) => {
      if (e.target.dataset.del) return;
      openSeatPicker(card.dataset.id);
    };
  });
  grid.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (ordersForTable(b.dataset.del).length) { toast("Bill or clear open orders on this table first"); return; }
      const ok = await showConfirm("This can't be undone.", { title: "Remove this table?", danger: true, okLabel: "Remove" });
      if (ok) await deleteDoc(doc(db, "restaurants", restoId, "tables", b.dataset.del));
    };
  });
}

// ---------- Seat picker modal ----------
// Lets staff tap exactly which chairs a party is sitting in before an order
// starts, and shows at a glance which chairs are already tied to someone
// else's running order — so a 4-seat table can be split "T13 A,B" for one
// party and "T13 C,D" for another without any mix-up at billing time.
function openSeatPicker(tableId) {
  seatPickerTable = tablesCache.find(t => t.id === tableId);
  if (!seatPickerTable) return;
  seatPickerSelected = [];
  $("seatPickerTitle").textContent = seatPickerTable.name;
  renderSeatPicker();
  $("seatPickerModal").classList.remove("hidden");
}
function closeSeatPicker() {
  $("seatPickerModal").classList.add("hidden");
  seatPickerTable = null;
  seatPickerSelected = [];
}
function renderSeatPicker() {
  if (!seatPickerTable) return;
  const letters = seatLettersFor(seatPickerTable);
  const occ = seatOccupancyMap(seatPickerTable.id);
  $("seatPickerChairs").innerHTML = letters.map(l => {
    const order = occ[l];
    const selected = seatPickerSelected.includes(l);
    const cls = order ? "seat-chip taken" : selected ? "seat-chip selected" : "seat-chip";
    return `<button type="button" class="${cls}" data-seat="${l}">
      <span class="seat-letter">${l.toUpperCase()}</span>
      <span class="seat-sub">${order ? (escapeHtml(order.customerName) || "occupied") : (selected ? "selected" : "free")}</span>
    </button>`;
  }).join("");

  $("seatPickerChairs").querySelectorAll(".seat-chip").forEach(chip => {
    chip.onclick = () => {
      const letter = chip.dataset.seat;
      const order = occ[letter];
      if (order) {
        // tapping a taken chair jumps straight into that party's running order
        openOrderForSeats(seatPickerTable, order.seatLabels, order);
        closeSeatPicker();
        return;
      }
      seatPickerSelected = seatPickerSelected.includes(letter)
        ? seatPickerSelected.filter(s => s !== letter)
        : [...seatPickerSelected, letter];
      renderSeatPicker();
    };
  });

  const freeLetters = letters.filter(l => !occ[l]);
  $("seatPickerSelectAll").style.display = freeLetters.length > 1 ? "inline-flex" : "none";
  $("seatPickerStartBtn").disabled = seatPickerSelected.length === 0;
  $("seatPickerStartBtn").textContent = seatPickerSelected.length
    ? `Start order — Seat${seatPickerSelected.length > 1 ? "s" : ""} ${seatLabelsText(seatPickerSelected)}`
    : "Select at least one seat";
}
$("seatPickerSelectAll").onclick = () => {
  if (!seatPickerTable) return;
  const letters = seatLettersFor(seatPickerTable);
  const occ = seatOccupancyMap(seatPickerTable.id);
  seatPickerSelected = letters.filter(l => !occ[l]);
  renderSeatPicker();
};
$("seatPickerClose").onclick = closeSeatPicker;
$("seatPickerCancel").onclick = closeSeatPicker;
$("seatPickerStartBtn").onclick = () => {
  if (!seatPickerTable || !seatPickerSelected.length) return;
  openOrderForSeats(seatPickerTable, [...seatPickerSelected], null);
  closeSeatPicker();
};

// ---------- Order view, now scoped to a seat group rather than a whole table ----------
async function openOrderForSeats(table, seatLabels, existingOrder) {
  activeTable = table;
  activeSeatLabels = seatLabels;
  $("orderTableEyebrow").textContent = existingOrder ? "Table · order in progress" : "Table · new order";
  $("orderTableName").textContent = `${table.name} · Seat${seatLabels.length > 1 ? "s" : ""} ${seatLabelsText(seatLabels)}`;

  cart = [];
  currentOrder = null;
  orderType = "dinein";
  paymentMode = "cash";
  activeCategory = null;
  staffUpsellShownFor = new Set();
  resetUpsellStaffUI();
  if ($("menuSearchInput")) $("menuSearchInput").value = "";
  if (existingOrder) {
    currentOrder = existingOrder;
    cart = existingOrder.items ? [...existingOrder.items] : [];
    orderType = existingOrder.orderType || "dinein";
    paymentMode = existingOrder.paymentMode || "cash";
    $("orderCustName").value = existingOrder.customerName || "";
    $("orderCustPhone").value = existingOrder.customerPhone || "";
  } else {
    $("orderCustName").value = "";
    $("orderCustPhone").value = "";
  }
  $("cartDiscount").value = 0;
  renderOrderTypeToggle();
  renderPaymentModeToggle();
  closeCartDrawer();
  showView("order");
  renderMenuPicker();
  renderCart();
}
$("backToTables").onclick = () => showView("tables");

// ===================== MENU BUILDER =====================
let variantRowCount = 0, addonRowCount = 0;
let mbActiveCategory = "All", mbSearchTerm = "";

// Preset category list (PetPooja-style) — the owner just picks one, no
// category-creation step. Any legacy/custom category already saved on an
// item is appended automatically so old data still shows correctly.
const DEFAULT_CATEGORIES = [
  "Starters / Appetizers", "Soups", "Salads", "Indian Breads",
  "Main Course - Veg", "Main Course - Non-Veg", "Rice & Biryani",
  "Noodles & Chinese", "South Indian", "Tandoor / Grill", "Pizza",
  "Burgers & Sandwiches", "Wraps & Rolls", "Pasta", "Combos / Thali",
  "Desserts", "Beverages", "Mocktails & Shakes", "Tea & Coffee",
  "Ice Cream", "Bakery & Snacks", "Sides & Extras"
];
function allCategories() {
  const used = [...new Set(menuCache.map(i => i.category).filter(Boolean))];
  const extra = used.filter(c => !DEFAULT_CATEGORIES.includes(c)).sort();
  return [...DEFAULT_CATEGORIES, ...extra];
}


// ===================== MERGE DUPLICATE CATEGORIES =====================
// Finds categories that are really the same thing ("Starter" vs "Starters / Appetizers",
// "pizza" vs "Pizza") and moves their items into one category. Nothing is deleted
// except the empty duplicate name (categories only exist through their items).
const CAT_ALIASES = {
  "starter": "Starters / Appetizers", "appetizer": "Starters / Appetizers", "starters appetizers": "Starters / Appetizers",
  "soup": "Soups", "salad": "Salads", "bread": "Indian Breads", "indian bread": "Indian Breads",
  "tea": "Tea & Coffee", "coffee": "Tea & Coffee", "tea coffee": "Tea & Coffee", "tea and coffee": "Tea & Coffee",
  "beverage": "Beverages", "drink": "Beverages", "mocktail": "Mocktails & Shakes", "shake": "Mocktails & Shakes",
  "mocktail shake": "Mocktails & Shakes", "mocktail and shake": "Mocktails & Shakes",
  "burger": "Burgers & Sandwiches", "sandwich": "Burgers & Sandwiches", "burger sandwich": "Burgers & Sandwiches", "burger and sandwich": "Burgers & Sandwiches",
  "wrap": "Wraps & Rolls", "roll": "Wraps & Rolls", "wrap roll": "Wraps & Rolls", "wrap and roll": "Wraps & Rolls",
  "dessert": "Desserts", "icecream": "Ice Cream", "ice cream": "Ice Cream", "bakery": "Bakery & Snacks", "snack": "Bakery & Snacks",
  "bakery snack": "Bakery & Snacks", "bakery and snack": "Bakery & Snacks", "combo": "Combos / Thali", "thali": "Combos / Thali",
  "main course veg": "Main Course - Veg", "main course non veg": "Main Course - Non-Veg", "main course nonveg": "Main Course - Non-Veg"
};
function catStem(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter(Boolean).map(w => w.replace(/ies$/, "y").replace(/(ch|sh|x|ss)es$/, "$1").replace(/s$/, "")).join(" ");
}
function findDuplicateCategories() {
  const counts = {};
  menuCache.forEach(i => { if (i.category) counts[i.category] = (counts[i.category] || 0) + 1; });
  const defaultByStem = {};
  DEFAULT_CATEGORIES.forEach(c => { defaultByStem[catStem(c)] = c; });
  const groups = {};                       // stem -> [names]
  Object.keys(counts).forEach(name => {
    const stem = catStem(name);
    const target = defaultByStem[stem] || CAT_ALIASES[stem] || null;
    const key = target ? "D:" + target : "C:" + stem;
    (groups[key] = groups[key] || { target, names: [] }).names.push(name);
  });
  const plans = [];
  Object.values(groups).forEach(g => {
    const hasTarget = g.target && g.names.includes(g.target);
    const keep = g.target || g.names.slice().sort((x, y) => counts[y] - counts[x] || x.localeCompare(y))[0];
    const move = g.names.filter(n => n !== keep);
    if (move.length) plans.push({ keep, move: move.map(n => ({ name: n, count: counts[n] })) });
  });
  return plans;
}
async function mergeDuplicateCategories() {
  const plans = findDuplicateCategories();
  if (!plans.length) { toast("No duplicate categories found ✓"); return; }
  const lines = plans.map(p => p.move.map(m => `• "${m.name}" (${m.count} item${m.count === 1 ? "" : "s"}) → "${p.keep}"`).join("\n")).join("\n");
  const ok = await showConfirm(`These categories look like duplicates. Their items will be moved into the category on the right, and the duplicate name will disappear:\n\n${lines}`, { title: "Merge duplicate categories?", okLabel: "Merge" });
  if (!ok) return;
  const jobs = [];
  plans.forEach(p => p.move.forEach(m => {
    menuCache.filter(i => i.category === m.name).forEach(i => {
      jobs.push(updateDoc(doc(db, "restaurants", restoId, "menu", i.id), { category: p.keep }));
    });
  }));
  try { await Promise.all(jobs); toast(`Merged — ${jobs.length} item${jobs.length === 1 ? "" : "s"} moved`); }
  catch (e) { console.error(e); toast("Couldn't merge categories — please try again"); }
}
if ($("mergeCatsBtn")) $("mergeCatsBtn").onclick = mergeDuplicateCategories;

// ===================== SAMPLE MENU (60 cafe items, Indian market pricing) =====================
// Used by the "Load 60 sample items" button below — a quick way to seed a
// new café's menu instead of typing 60 items by hand. Safe to run more than
// once, but running it twice will create duplicate items since it always adds
// new docs rather than checking for existing names.
const SAMPLE_MENU_60 = [
  // Tea & Coffee (7)
  { name: "Masala Chai", category: "Tea & Coffee", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 40 }, { name: "Large", price: 60 }], addons: [] },
  { name: "Ginger Chai", category: "Tea & Coffee", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 40 }, { name: "Large", price: 60 }], addons: [] },
  { name: "Filter Coffee", category: "Tea & Coffee", veg: "veg", basePrice: 50, variants: [], addons: [] },
  { name: "Cappuccino", category: "Tea & Coffee", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 90 }, { name: "Large", price: 120 }], addons: [{ name: "Extra Shot", price: 30 }] },
  { name: "Cafe Latte", category: "Tea & Coffee", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 100 }, { name: "Large", price: 130 }], addons: [{ name: "Extra Shot", price: 30 }, { name: "Vanilla Syrup", price: 20 }] },
  { name: "Espresso", category: "Tea & Coffee", veg: "veg", basePrice: 80, variants: [], addons: [] },
  { name: "Hot Chocolate", category: "Tea & Coffee", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 110 }, { name: "Large", price: 140 }], addons: [] },

  // Beverages — cold (5)
  { name: "Cold Coffee", category: "Beverages", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 110 }, { name: "Large", price: 140 }], addons: [{ name: "Extra Shot", price: 30 }, { name: "Whipped Cream", price: 25 }] },
  { name: "Iced Americano", category: "Beverages", veg: "veg", basePrice: 100, variants: [], addons: [] },
  { name: "Fresh Lime Soda", category: "Beverages", veg: "veg", basePrice: 70, variants: [], addons: [] },
  { name: "Virgin Mojito", category: "Beverages", veg: "veg", basePrice: 130, variants: [], addons: [] },
  { name: "Iced Tea (Lemon)", category: "Beverages", veg: "veg", basePrice: 0, variants: [{ name: "Regular", price: 90 }, { name: "Large", price: 120 }], addons: [] },

  // Mocktails & Shakes (5)
  { name: "Oreo Shake", category: "Mocktails & Shakes", veg: "veg", basePrice: 150, variants: [], addons: [] },
  { name: "Chocolate Shake", category: "Mocktails & Shakes", veg: "veg", basePrice: 150, variants: [], addons: [] },
  { name: "Strawberry Shake", category: "Mocktails & Shakes", veg: "veg", basePrice: 150, variants: [], addons: [] },
  { name: "Blue Lagoon Mocktail", category: "Mocktails & Shakes", veg: "veg", basePrice: 160, variants: [], addons: [] },
  { name: "Watermelon Cooler", category: "Mocktails & Shakes", veg: "veg", basePrice: 140, variants: [], addons: [] },

  // Bakery & Snacks (5)
  { name: "Chocolate Brownie", category: "Bakery & Snacks", veg: "veg", basePrice: 120, variants: [], addons: [{ name: "Vanilla Ice Cream Scoop", price: 40 }, { name: "Hot Chocolate Sauce", price: 20 }] },
  { name: "Blueberry Muffin", category: "Bakery & Snacks", veg: "veg", basePrice: 90, variants: [], addons: [] },
  { name: "Butter Croissant", category: "Bakery & Snacks", veg: "veg", basePrice: 90, variants: [], addons: [] },
  { name: "Veg Puff", category: "Bakery & Snacks", veg: "veg", basePrice: 40, variants: [], addons: [] },
  { name: "Chicken Puff", category: "Bakery & Snacks", veg: "nonveg", basePrice: 60, variants: [], addons: [] },

  // Burgers & Sandwiches (5)
  { name: "Veg Grilled Sandwich", category: "Burgers & Sandwiches", veg: "veg", basePrice: 130, variants: [], addons: [{ name: "Extra Cheese", price: 30 }] },
  { name: "Paneer Tikka Sandwich", category: "Burgers & Sandwiches", veg: "veg", basePrice: 150, variants: [], addons: [{ name: "Extra Cheese", price: 30 }] },
  { name: "Chicken Club Sandwich", category: "Burgers & Sandwiches", veg: "nonveg", basePrice: 180, variants: [], addons: [{ name: "Extra Cheese", price: 30 }, { name: "Extra Bacon", price: 40 }] },
  { name: "Classic Veg Burger", category: "Burgers & Sandwiches", veg: "veg", basePrice: 130, variants: [], addons: [{ name: "Extra Cheese Slice", price: 25 }, { name: "Extra Patty", price: 50 }] },
  { name: "Chicken Burger", category: "Burgers & Sandwiches", veg: "nonveg", basePrice: 170, variants: [], addons: [{ name: "Extra Cheese Slice", price: 25 }, { name: "Extra Patty", price: 60 }] },

  // Wraps & Rolls (4)
  { name: "Paneer Tikka Wrap", category: "Wraps & Rolls", veg: "veg", basePrice: 140, variants: [], addons: [{ name: "Extra Cheese", price: 25 }] },
  { name: "Veg Frankie Roll", category: "Wraps & Rolls", veg: "veg", basePrice: 110, variants: [], addons: [] },
  { name: "Chicken Tikka Wrap", category: "Wraps & Rolls", veg: "nonveg", basePrice: 160, variants: [], addons: [{ name: "Extra Cheese", price: 25 }] },
  { name: "Egg Roll", category: "Wraps & Rolls", veg: "nonveg", basePrice: 100, variants: [], addons: [] },

  // Pizza (5)
  { name: "Margherita Pizza", category: "Pizza", veg: "veg", basePrice: 0, variants: [{ name: "7\" Small", price: 220 }, { name: "10\" Medium", price: 350 }, { name: "12\" Large", price: 480 }], addons: [{ name: "Extra Cheese", price: 60 }, { name: "Jalapeno", price: 40 }, { name: "Olives", price: 40 }] },
  { name: "Farmhouse Pizza", category: "Pizza", veg: "veg", basePrice: 0, variants: [{ name: "7\" Small", price: 260 }, { name: "10\" Medium", price: 400 }, { name: "12\" Large", price: 540 }], addons: [{ name: "Extra Cheese", price: 60 }, { name: "Extra Veggies", price: 50 }] },
  { name: "Paneer Tikka Pizza", category: "Pizza", veg: "veg", basePrice: 0, variants: [{ name: "7\" Small", price: 280 }, { name: "10\" Medium", price: 430 }, { name: "12\" Large", price: 560 }], addons: [{ name: "Extra Cheese", price: 60 }] },
  { name: "Chicken Tikka Pizza", category: "Pizza", veg: "nonveg", basePrice: 0, variants: [{ name: "7\" Small", price: 300 }, { name: "10\" Medium", price: 460 }, { name: "12\" Large", price: 600 }], addons: [{ name: "Extra Cheese", price: 60 }, { name: "Extra Chicken", price: 80 }] },
  { name: "Peppy Paneer Pizza", category: "Pizza", veg: "veg", basePrice: 0, variants: [{ name: "7\" Small", price: 270 }, { name: "10\" Medium", price: 420 }, { name: "12\" Large", price: 550 }], addons: [{ name: "Extra Cheese", price: 60 }] },

  // Pasta (4)
  { name: "Penne Alfredo (White Sauce)", category: "Pasta", veg: "veg", basePrice: 220, variants: [], addons: [{ name: "Extra Cheese", price: 40 }] },
  { name: "Penne Arrabbiata (Red Sauce)", category: "Pasta", veg: "veg", basePrice: 200, variants: [], addons: [] },
  { name: "Chicken Pasta (Creamy)", category: "Pasta", veg: "nonveg", basePrice: 260, variants: [], addons: [{ name: "Extra Chicken", price: 70 }] },
  { name: "Mac & Cheese", category: "Pasta", veg: "veg", basePrice: 210, variants: [], addons: [] },

  // Starters / Appetizers (5)
  { name: "Paneer Tikka", category: "Starters / Appetizers", veg: "veg", basePrice: 220, variants: [], addons: [] },
  { name: "Veg Spring Roll", category: "Starters / Appetizers", veg: "veg", basePrice: 160, variants: [], addons: [] },
  { name: "Chilli Paneer (Dry)", category: "Starters / Appetizers", veg: "veg", basePrice: 210, variants: [], addons: [] },
  { name: "Chicken 65", category: "Starters / Appetizers", veg: "nonveg", basePrice: 240, variants: [], addons: [] },
  { name: "Chicken Lollipop (6 pcs)", category: "Starters / Appetizers", veg: "nonveg", basePrice: 260, variants: [], addons: [] },

  // Main Course - Veg (3)
  { name: "Paneer Butter Masala", category: "Main Course - Veg", veg: "veg", basePrice: 250, variants: [], addons: [] },
  { name: "Dal Makhani", category: "Main Course - Veg", veg: "veg", basePrice: 200, variants: [], addons: [] },
  { name: "Veg Kolhapuri", category: "Main Course - Veg", veg: "veg", basePrice: 220, variants: [], addons: [] },

  // Main Course - Non-Veg (3)
  { name: "Butter Chicken", category: "Main Course - Non-Veg", veg: "nonveg", basePrice: 300, variants: [], addons: [] },
  { name: "Chicken Curry", category: "Main Course - Non-Veg", veg: "nonveg", basePrice: 260, variants: [], addons: [] },
  { name: "Egg Curry", category: "Main Course - Non-Veg", veg: "nonveg", basePrice: 180, variants: [], addons: [] },

  // Desserts (4)
  { name: "Chocolate Lava Cake", category: "Desserts", veg: "veg", basePrice: 150, variants: [], addons: [{ name: "Vanilla Ice Cream Scoop", price: 40 }] },
  { name: "Gulab Jamun (2 pcs)", category: "Desserts", veg: "veg", basePrice: 90, variants: [], addons: [] },
  { name: "Tiramisu", category: "Desserts", veg: "veg", basePrice: 180, variants: [], addons: [] },
  { name: "Red Velvet Pastry", category: "Desserts", veg: "veg", basePrice: 130, variants: [], addons: [] },

  // Ice Cream (3)
  { name: "Vanilla Ice Cream", category: "Ice Cream", veg: "veg", basePrice: 0, variants: [{ name: "Single Scoop", price: 70 }, { name: "Double Scoop", price: 120 }], addons: [] },
  { name: "Chocolate Ice Cream", category: "Ice Cream", veg: "veg", basePrice: 0, variants: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], addons: [] },
  { name: "Butterscotch Ice Cream", category: "Ice Cream", veg: "veg", basePrice: 0, variants: [{ name: "Single Scoop", price: 80 }, { name: "Double Scoop", price: 130 }], addons: [] },

  // Salads (2)
  { name: "Classic Caesar Salad", category: "Salads", veg: "veg", basePrice: 160, variants: [], addons: [{ name: "Grilled Chicken", price: 80 }] },
  { name: "Sprouts & Veggie Salad", category: "Salads", veg: "veg", basePrice: 130, variants: [], addons: [] }
];

$("addItemBtn").onclick = () => openItemModal(null);
$("itemModalClose").onclick = () => $("itemModal").classList.add("hidden");

function openItemModal(item) {
  editingItemId = item ? item.id : null;
  $("itemModalTitle").textContent = item ? "Edit menu item" : "Add menu item";
  $("itmName").value = item ? item.name : "";
  populateCategoryDropdown(item ? item.category : (mbActiveCategory !== "All" ? mbActiveCategory : ""));
  setVegToggle(item ? item.veg : "veg");
  $("itmBasePrice").value = item ? (item.basePrice || 0) : 0;
  $("variantRows").innerHTML = "";
  $("addonRows").innerHTML = "";
  (item?.variants || []).forEach(v => addVariantRow(v.name, v.price));
  (item?.addons || []).forEach(a => addAddonRow(a.name, a.price));
  populateUpsellPicker(item);
  $("deleteItemBtn").classList.toggle("hidden", !item);
  $("itemModal").classList.remove("hidden");
}

// Checklist of every other menu item, so the owner can pick which ones get
// suggested when a customer adds this item on the QR ordering page.
function populateUpsellPicker(item) {
  const el = $("upsellPickerList");
  if (!el) return;
  const selected = new Set(item?.upsellIds || []);
  const others = menuCache.filter(i => i.id !== item?.id);
  if (!others.length) { el.innerHTML = `<div class="upsell-empty">Add a few more menu items first, then come back to set up suggestions.</div>`; return; }
  el.innerHTML = others.map(i => `
    <label class="upsell-pick-row">
      <input type="checkbox" value="${i.id}" ${selected.has(i.id) ? "checked" : ""}>
      <span class="upr-name">${escapeHtml(i.name)}</span>
      <span class="upr-price">${i.variants?.length ? "from ₹" + Math.min(...i.variants.map(v => v.price)) : "₹" + (i.basePrice || 0)}</span>
    </label>`).join("");
}
function getSelectedUpsellIds() {
  return [...document.querySelectorAll("#upsellPickerList input[type=checkbox]:checked")].map(c => c.value);
}

// Category dropdown: pick from a ready-made list of food categories —
// nothing to type or create.
function populateCategoryDropdown(selected) {
  const categories = allCategories();
  const sel = $("itmCategorySelect");
  sel.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join("");
  sel.value = selected && categories.includes(selected) ? selected : categories[0];
}

// Veg / non-veg toggle (replaces a plain <select> with PetPooja-style chips)
function setVegToggle(value) {
  $("itmVegToggle").querySelectorAll(".veg-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.veg === value));
}
$("itmVegToggle").querySelectorAll(".veg-btn").forEach(b => {
  b.onclick = () => setVegToggle(b.dataset.veg);
});
function getVegToggleValue() {
  return $("itmVegToggle").querySelector(".veg-btn.active")?.dataset.veg || "veg";
}

function addVariantRow(name = "", price = "") {
  const id = "vr" + (variantRowCount++);
  const row = document.createElement("div");
  row.className = "variant-row";
  row.id = id;
  row.innerHTML = `<input type="text" placeholder="e.g. Small / Medium / Large" class="vr-name" value="${name}">
    <input type="number" placeholder="Price" class="vr-price" value="${price}" style="width:90px">
    <button class="row-del" onclick="document.getElementById('${id}').remove()">✕</button>`;
  $("variantRows").appendChild(row);
}
function addAddonRow(name = "", price = "") {
  const id = "ar" + (addonRowCount++);
  const row = document.createElement("div");
  row.className = "addon-row";
  row.id = id;
  row.innerHTML = `<input type="text" placeholder="e.g. Extra Cheese / Jalapeno" class="ar-name" value="${name}">
    <input type="number" placeholder="Price" class="ar-price" value="${price}" style="width:90px">
    <button class="row-del" onclick="document.getElementById('${id}').remove()">✕</button>`;
  $("addonRows").appendChild(row);
}
$("addVariantRow").onclick = () => addVariantRow();
$("addAddonRow").onclick = () => addAddonRow();

// ===================== AUTO SUGGESTIONS (category-based fallback) =====================
// If staff save an item without manually ticking any "goes great with"
// boxes, we auto-pick sensible suggestions from companion categories —
// this runs on every save from now on, so newly added items always get a
// suggestion without anyone having to remember to set one by hand.
// Manually ticked boxes always win; this only fills in when none were picked.
const UPSELL_CATEGORY_PAIRINGS = {
  "pizza": ["starters appetizers", "beverages"],
  "burgers sandwiches": ["beverages", "desserts"],
  "pasta": ["starters appetizers", "beverages"],
  "main course non veg": ["starters appetizers", "beverages"],
  "main course veg": ["starters appetizers", "beverages"],
  "wraps rolls": ["beverages", "salads"],
  "starters appetizers": ["mocktails shakes", "beverages"],
  "starter": ["mocktails shakes", "beverages"],
  "tea coffee": ["bakery snacks", "desserts"],
  "mocktails shakes": ["starters appetizers", "desserts"],
  "beverages": ["starters appetizers", "bakery snacks"],
  "salads": ["main course veg", "beverages"],
  "bakery snacks": ["tea coffee", "beverages"],
  "desserts": ["tea coffee", "mocktails shakes"],
  "ice cream": ["tea coffee", "mocktails shakes"]
};
function normCat(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function autoUpsellSuggestions(category, excludeId) {
  const companionCats = UPSELL_CATEGORY_PAIRINGS[normCat(category)] || [];
  let pool = menuCache.filter(m => m.id !== excludeId && m.available !== false && companionCats.includes(normCat(m.category)));
  const picks = [];
  const seenCats = new Set();
  for (const p of pool) {
    if (picks.length >= 2) break;
    if (seenCats.has(normCat(p.category)) && picks.length > 0) continue;
    picks.push(p);
    seenCats.add(normCat(p.category));
  }
  if (picks.length < 2) { for (const p of pool) { if (picks.length >= 2) break; if (!picks.includes(p)) picks.push(p); } }
  return picks.map(p => p.id);
}

$("saveItemBtn").onclick = async () => {
  const name = $("itmName").value.trim();
  if (!name) { toast("Item name required"); return; }
  const variants = [...document.querySelectorAll(".variant-row")].map(r => ({
    name: r.querySelector(".vr-name").value.trim(),
    price: Math.max(0, parseFloat(r.querySelector(".vr-price").value) || 0)
  })).filter(v => v.name);
  const addons = [...document.querySelectorAll(".addon-row")].map(r => ({
    name: r.querySelector(".ar-name").value.trim(),
    price: Math.max(0, parseFloat(r.querySelector(".ar-price").value) || 0)
  })).filter(a => a.name);

  const category = $("itmCategorySelect").value || "Uncategorised";
  let upsellIds = getSelectedUpsellIds();
  if (!upsellIds.length) upsellIds = autoUpsellSuggestions(category, editingItemId);

  const data = {
    name,
    category,
    veg: getVegToggleValue(),
    basePrice: Math.max(0, parseFloat($("itmBasePrice").value) || 0),
    variants, addons, available: true,
    upsellIds
  };
  if (editingItemId) {
    await updateDoc(doc(db, "restaurants", restoId, "menu", editingItemId), data);
  } else {
    await addDoc(collection(db, "restaurants", restoId, "menu"), data);
  }
  $("itemModal").classList.add("hidden");
  toast("Menu item saved");
};

$("deleteItemBtn").onclick = async () => {
  if (!editingItemId) return;
  const ok = await showConfirm("This can't be undone.", { title: "Delete this menu item?", danger: true, okLabel: "Delete" });
  if (ok) {
    await deleteDoc(doc(db, "restaurants", restoId, "menu", editingItemId));
    $("itemModal").classList.add("hidden");
  }
};

$("mbSearchInput").oninput = (e) => { mbSearchTerm = e.target.value.trim().toLowerCase(); renderMenuBuilder(); };

function vegIcon(veg) {
  // Small square outline with a coloured dot inside — the familiar
  // veg/non-veg mark used on Indian restaurant menus & POS systems.
  return `<span class="veg-mark ${(veg === "nonveg" || veg === false) ? "nonveg" : "veg"}"><span></span></span>`;
}

function renderMenuBuilder() {
  const rail = $("mbCatRail");
  const el = $("menuBuilderList");

  if (!menuCache.length) {
    rail.innerHTML = "";
    $("mbItemCount").textContent = "";
    el.innerHTML = `<div class="empty-note">No menu items yet. Click "+ Add item" — pick a category, set a price, and optionally add sizes / add-ons.</div>`;
    return;
  }

  // categories present in the menu, in preset order, each with a count
  const present = allCategories().filter(c => menuCache.some(i => i.category === c));
  const counts = {};
  menuCache.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
  if (!present.includes(mbActiveCategory) && mbActiveCategory !== "All") mbActiveCategory = "All";

  rail.innerHTML = `<button class="mb-cat-btn ${mbActiveCategory === "All" ? "active" : ""}" data-cat="All">
      <span>All items</span><span class="mb-cat-count">(${menuCache.length})</span>
    </button>` + present.map(c => `
    <button class="mb-cat-btn ${mbActiveCategory === c ? "active" : ""}" data-cat="${c}">
      <span>${c}</span><span class="mb-cat-count">(${counts[c]})</span>
    </button>`).join("");
  rail.querySelectorAll(".mb-cat-btn").forEach(b => {
    b.onclick = () => { mbActiveCategory = b.dataset.cat; renderMenuBuilder(); };
  });

  let items = menuCache;
  if (mbActiveCategory !== "All") items = items.filter(i => i.category === mbActiveCategory);
  if (mbSearchTerm) items = items.filter(i => i.name.toLowerCase().includes(mbSearchTerm));
  items = [...items].sort((a, b) => a.name.localeCompare(b.name));

  $("mbItemCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    el.innerHTML = `<div class="empty-note">No items match here.</div>`;
    return;
  }

  el.innerHTML = items.map(i => `
    <div class="mb-card" data-id="${i.id}">
      ${vegIcon(i.veg)}
      <div class="mb-card-main">
        <div class="mb-name">${escapeHtml(i.name)}</div>
        <div class="mb-meta">
          <span class="mb-cat-pill">${escapeHtml(i.category)}</span>
          ${i.addons?.length ? `<span class="mb-addon-pill">${i.addons.length} add-on${i.addons.length === 1 ? "" : "s"}</span>` : ""}
        </div>
      </div>
      <div class="mb-card-price">
        ${i.variants?.length
          ? i.variants.map(v => `<div class="mb-price-line"><span>${escapeHtml(v.name)}</span><span>${money(v.price)}</span></div>`).join("")
          : `<div class="mb-price-line mb-price-single">${money(i.basePrice)}</div>`}
      </div>
      <div class="mb-card-arrow">›</div>
    </div>`).join("");
  el.querySelectorAll(".mb-card").forEach(r => {
    r.onclick = () => openItemModal(menuCache.find(i => i.id === r.dataset.id));
  });
}

// ---------- small inline icon set shared by the Staff and QR screens ----------
const SQ = (d) => `<svg class="sq-ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const SQP = {
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M20 11.5a8 8 0 0 1-11.7 7L4 20l1.5-4.2A8 8 0 1 1 20 11.5z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.5a6 6 0 0 1 3 5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 21h4"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13"/><path d="M4 13v6h16v-6h-5l-1 2h-4l-1-2H4z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  down: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
};

// ===================== STAFF =====================
// The staff area (personal details + attendance) asks for the owner's staff
// password once. After that it STAYS open while the owner moves around the
// app or switches windows -- it only locks again when they press "Lock now",
// sign out, or close the browser tab.
const ATT_META = {
  present: { label: "Present", color: "#12995A" },
  halfday: { label: "Half-day", color: "#D49A12" },
  leave: { label: "Leave", color: "#2B79B5" },
  absent: { label: "Absent", color: "#C4293D" },
  none: { label: "Not marked", color: "#B6AE9B" },
};
let staffFilter = { q: "", role: "", status: "all" };

function staffUnlockKey() { return "staffUnlocked:" + (restoId || ""); }
function isStaffUnlocked() {
  if (!staffUnlocked) { try { staffUnlocked = sessionStorage.getItem(staffUnlockKey()) === "1"; } catch (e) { /* storage blocked */ } }
  return staffUnlocked;
}
function setStaffUnlocked(v) {
  staffUnlocked = !!v;
  try { if (v) sessionStorage.setItem(staffUnlockKey(), "1"); else sessionStorage.removeItem(staffUnlockKey()); } catch (e) { /* storage blocked */ }
}

function renderStaffView() {
  const hasPin = !!restoData.staffPinHash;
  if (isStaffUnlocked()) {
    $("staffLockScreen").classList.add("hidden");
    $("staffContent").classList.remove("hidden");
    renderStaffGrid();
    return;
  }
  $("staffContent").classList.add("hidden");
  $("staffLockScreen").classList.remove("hidden");
  $("staffLockError").classList.add("hidden");
  $("staffLockInput").value = "";
  if (hasPin) {
    $("staffLockTitle").textContent = "Staff area is locked";
    $("staffLockSub").textContent = "Enter the owner's staff password to view staff and attendance.";
    $("staffLockConfirmWrap").classList.add("hidden");
    $("staffLockSubmitBtn").textContent = "Unlock";
  } else {
    $("staffLockTitle").textContent = "Set a staff password";
    $("staffLockSub").textContent = "This tab holds your team's personal details and attendance. Set a password now: only whoever knows it (you, the owner) can open this tab or change the password.";
    $("staffLockConfirmWrap").classList.remove("hidden");
    $("staffLockConfirmInput").value = "";
    $("staffLockSubmitBtn").textContent = "Set password & continue";
  }
  setTimeout(() => { try { $("staffLockInput").focus(); } catch (e) { /* hidden */ } }, 50);
}
function staffLockErr(msg) {
  const e = $("staffLockError");
  e.textContent = msg;
  e.classList.remove("hidden");
}
$("staffLockSubmitBtn").onclick = async () => {
  const hasPin = !!restoData.staffPinHash;
  const pass = $("staffLockInput").value;
  $("staffLockError").classList.add("hidden");
  if (!hasPin) {
    const confirm = $("staffLockConfirmInput").value;
    if (pass.length < 4) { staffLockErr("Password needs at least 4 characters."); return; }
    if (pass !== confirm) { staffLockErr("Passwords don't match."); return; }
    const hash = await sha256Hex(pass);
    await setDoc(doc(db, "restaurants", restoId), { staffPinHash: hash }, { merge: true });
    restoData.staffPinHash = hash;
    setStaffUnlocked(true);
    toast("Staff password set");
    renderStaffView();
    return;
  }
  const hash = await sha256Hex(pass);
  if (hash !== restoData.staffPinHash) { staffLockErr("Incorrect password."); return; }
  setStaffUnlocked(true);
  renderStaffView();
};
$("staffLockInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && $("staffLockConfirmWrap").classList.contains("hidden")) $("staffLockSubmitBtn").click(); });
$("staffLockConfirmInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("staffLockSubmitBtn").click(); });

// Only the owner locks it again, on purpose. No auto-lock on tab switch / blur / navigation.
$("staffLockNowBtn").onclick = () => { setStaffUnlocked(false); renderStaffView(); toast("Staff area locked"); };

$("staffChangePassBtn").onclick = async () => {
  const current = await showPrompt("Enter your current staff password to continue.", { title: "Confirm current password" });
  if (current === null) return;
  const currentHash = await sha256Hex(current);
  if (currentHash !== restoData.staffPinHash) { toast("Incorrect current password"); return; }
  const next = await showPrompt("Choose a new staff password (min 4 characters).", { title: "New staff password" });
  if (next === null) return;
  if (next.length < 4) { toast("Password too short — min 4 characters"); return; }
  const confirm = await showPrompt("Re-enter the new password to confirm.", { title: "Confirm new password" });
  if (confirm === null) return;
  if (confirm !== next) { toast("Passwords didn't match — nothing changed"); return; }
  const newHash = await sha256Hex(next);
  await setDoc(doc(db, "restaurants", restoId), { staffPinHash: newHash }, { merge: true });
  restoData.staffPinHash = newHash;
  toast("Staff password updated");
};

function avatarColorFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return STAFF_AVATAR_COLORS[hash % STAFF_AVATAR_COLORS.length];
}

// ---- attendance helpers ----
// One lookup of {staffId: {YYYY-MM-DD: status}} built from the live month window
// (this month + last 7 days) so the cards never need their own queries.
function buildAttendanceIndex() {
  const idx = {};
  const put = (a) => { if (!a.staffId || !a.date) return; (idx[a.staffId] = idx[a.staffId] || {})[a.date] = a.status || "none"; };
  staffRangeAttCache.forEach(put);
  todayAttendanceCache.forEach(put);
  return idx;
}
function statusForStaffToday(staffId) {
  const rec = todayAttendanceCache.find(a => a.staffId === staffId);
  return rec ? rec.status : "none";
}
function phoneDigits(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "0") d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d;
}
function fmtClock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return "";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function isOnShiftNow(s) {
  if (!s.shiftStart || !s.shiftEnd) return false;
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
  const a = toMin(s.shiftStart), b = toMin(s.shiftEnd);
  return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b); // overnight shifts wrap past midnight
}
function tenureText(joinDate) {
  if (!joinDate) return "";
  const j = new Date(joinDate + "T00:00:00");
  if (isNaN(j)) return "";
  const now = new Date();
  let months = (now.getFullYear() - j.getFullYear()) * 12 + (now.getMonth() - j.getMonth());
  if (now.getDate() < j.getDate()) months--;
  if (months < 0) return "Joining soon";
  if (months < 1) { const d = Math.max(0, Math.floor((now - j) / 86400000)); return d === 0 ? "Joined today" : `${d} day${d === 1 ? "" : "s"} with you`; }
  const y = Math.floor(months / 12), m = months % 12;
  return `${y ? y + "y " : ""}${m ? m + "m" : ""}`.trim() + " with you";
}

function renderStaffRoster(counts, total) {
  const box = $("staffRoster");
  if (!box) return;
  const now = new Date();
  const dateTxt = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  if (!total) {
    box.innerHTML = `<div class="sf-roster-main"><div class="sf-roster-top"><span class="sf-roster-num">0</span><span class="sf-roster-cap"><b>${escapeHtml(dateTxt)}</b><br>No team members yet</span></div>
      <div class="sf-meter"></div></div>
      <div class="sf-roster-side"><span class="sf-side-label">Add your first team member to start marking attendance.</span></div>`;
    return;
  }
  const inCount = counts.present + counts.halfday;
  const w = (n) => (n / total * 100).toFixed(2) + "%";
  const present = staffCache.filter(s => { const st = statusForStaffToday(s.id); return st === "present" || st === "halfday"; });
  const faces = present.slice(0, 6).map(s =>
    `<span class="sf-face" style="background:${avatarColorFor(s.id)}" title="${escapeHtml(s.name)}">${escapeHtml(initialsOf(s.name))}</span>`).join("")
    + (present.length > 6 ? `<span class="sf-face more">+${present.length - 6}</span>` : "");
  box.innerHTML = `
    <div class="sf-roster-main">
      <div class="sf-roster-top">
        <span class="sf-roster-num">${inCount}</span>
        <span class="sf-roster-cap"><b>of ${total} in today</b><br>${escapeHtml(dateTxt)}</span>
      </div>
      <div class="sf-meter" role="img" aria-label="${counts.present} present, ${counts.halfday} half-day, ${counts.leave} on leave, ${counts.absent} absent, ${counts.none} not marked">
        <i class="m-present" style="width:${w(counts.present)}"></i><i class="m-half" style="width:${w(counts.halfday)}"></i><i class="m-leave" style="width:${w(counts.leave)}"></i><i class="m-absent" style="width:${w(counts.absent)}"></i>
      </div>
      <div class="sf-legend">
        ${["present", "halfday", "leave", "absent", "none"].map(k => `<span><i style="background:${k === "none" ? "rgba(255,255,255,.35)" : ATT_META[k].color}"></i><b>${counts[k]}</b>${ATT_META[k].label}</span>`).join("")}
      </div>
    </div>
    <div class="sf-roster-side">
      <span class="sf-side-label">${present.length ? "On the floor today" : "Nobody marked present yet"}</span>
      ${faces ? `<div class="sf-faces">${faces}</div>` : ""}
      ${counts.none > 0
        ? `<button type="button" class="sf-markall" id="staffMarkAllBtn">${SQ(SQP.check)}Mark ${counts.none} unmarked as present</button>`
        : `<span class="sf-roster-done">${SQ(SQP.check)}Everyone is marked for today</span>`}
    </div>`;
}

function staffCardHtml(s, idx, today, weekDays, monthPrefix) {
  const days = idx[s.id] || {};
  const st = days[today] || "none";
  const meta = ATT_META[st];
  const onShift = (st === "present" || st === "halfday") && isOnShiftNow(s);
  const monthCounts = { present: 0, halfday: 0, leave: 0, absent: 0 };
  Object.keys(days).forEach(d => { if (d.startsWith(monthPrefix) && monthCounts.hasOwnProperty(days[d])) monthCounts[days[d]]++; });
  const digits = phoneDigits(s.phone);
  const shift = s.shiftStart && s.shiftEnd ? `${fmtClock(s.shiftStart)} – ${fmtClock(s.shiftEnd)}` : "";
  const tenure = tenureText(s.joinDate);
  const week = weekDays.map(d => {
    const ds = days[d.ds] || "none";
    return `<div class="sf-day s-${ds}${d.ds === today ? " today" : ""}" title="${escapeHtml(d.label)}: ${ATT_META[ds].label}"><i></i>${d.letter}</div>`;
  }).join("");
  const seg = ["present", "halfday", "leave", "absent"].map(k =>
    `<button type="button" data-s="${k}" data-mark="${s.id}|${k}" class="${st === k ? "on" : ""}" aria-pressed="${st === k}">${k === "halfday" ? "Half" : ATT_META[k].label}</button>`).join("");
  return `
  <article class="sf-card" data-st="${st}" data-id="${s.id}">
    <div class="sf-card-top">
      <div class="sf-avatar" style="background:${avatarColorFor(s.id)}">${escapeHtml(initialsOf(s.name))}${onShift ? '<span class="sf-pulse" title="On shift now"></span>' : ""}</div>
      <div class="sf-id">
        <div class="sf-name">${escapeHtml(s.name) || "Unnamed"}</div>
        <span class="sf-role">${escapeHtml(s.role) || "Staff"}</span>
      </div>
      <button type="button" class="sf-edit" data-edit="${s.id}" aria-label="Edit ${escapeHtml(s.name)}" title="Edit">${SQ(SQP.pencil)}</button>
    </div>
    ${(shift || tenure || onShift) ? `<div class="sf-meta">
      ${onShift ? `<span class="sf-onshift">${SQ(SQP.clock)}On shift now</span>` : ""}
      ${shift && !onShift ? `<span>${SQ(SQP.clock)}${shift}</span>` : ""}
      ${shift && onShift ? `<span>${shift}</span>` : ""}
      ${tenure ? `<span>${SQ(SQP.user)}${tenure}</span>` : ""}
    </div>` : ""}
    ${digits ? `<div class="sf-contact"><a href="tel:+${digits}">${SQ(SQP.phone)}Call</a><a class="wa" href="https://wa.me/${digits}" target="_blank" rel="noopener">${SQ(SQP.chat)}WhatsApp</a></div>` : ""}
    <div class="sf-today">
      <div class="sf-today-row"><b>${meta.label} today</b><small>${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></div>
      <div class="sf-seg" role="group" aria-label="Today's attendance for ${escapeHtml(s.name)}">${seg}</div>
    </div>
    <div class="sf-month">
      <div class="sf-month-head"><b>This month</b><small>${new Date().toLocaleDateString("en-IN", { month: "long" })}</small></div>
      <div class="sf-counts">
        <span><i style="background:${ATT_META.present.color}"></i><b>${monthCounts.present}</b> present</span>
        <span><i style="background:${ATT_META.halfday.color}"></i><b>${monthCounts.halfday}</b> half</span>
        <span><i style="background:${ATT_META.leave.color}"></i><b>${monthCounts.leave}</b> leave</span>
        <span><i style="background:${ATT_META.absent.color}"></i><b>${monthCounts.absent}</b> absent</span>
      </div>
      <div class="sf-week" aria-label="Last 7 days">${week}</div>
    </div>
    <button type="button" class="sf-cal" data-cal="${s.id}">${SQ(SQP.cal)}Attendance calendar</button>
  </article>`;
}

function renderStaffGrid() {
  const grid = $("staffGrid");
  if (!grid) return;
  const today = todayStr();
  const idx = buildAttendanceIndex();
  const stOf = (s) => (idx[s.id] && idx[s.id][today]) || "none";

  const counts = { present: 0, halfday: 0, leave: 0, absent: 0, none: 0 };
  staffCache.forEach(s => { const k = stOf(s); counts[counts.hasOwnProperty(k) ? k : "none"]++; });
  renderStaffRoster(counts, staffCache.length);

  const roles = [...new Set(staffCache.map(s => (s.role || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $("staffSubline").textContent = staffCache.length
    ? `${staffCache.length} team member${staffCache.length === 1 ? "" : "s"}${roles.length ? ` across ${roles.length} role${roles.length === 1 ? "" : "s"}` : ""}. Mark attendance as people arrive.`
    : "Add your team to track attendance and shifts.";

  // role dropdown (rebuilt only when the role list changes so the selection isn't lost)
  const sel = $("staffRoleFilter");
  const roleSig = roles.join("|");
  if (sel.dataset.sig !== roleSig) {
    sel.dataset.sig = roleSig;
    sel.innerHTML = `<option value="">All roles</option>` + roles.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
  }
  if (staffFilter.role && !roles.includes(staffFilter.role)) staffFilter.role = "";
  sel.value = staffFilter.role;

  // status chips
  const chips = [["all", "All", staffCache.length, "#1B5E4A"], ["present", "Present", counts.present, ATT_META.present.color], ["halfday", "Half-day", counts.halfday, ATT_META.halfday.color],
    ["leave", "Leave", counts.leave, ATT_META.leave.color], ["absent", "Absent", counts.absent, ATT_META.absent.color], ["none", "Not marked", counts.none, ATT_META.none.color]];
  $("staffFilterChips").innerHTML = chips.map(([k, label, n, c]) =>
    `<button type="button" class="sf-chip${staffFilter.status === k ? " on" : ""}" data-chip="${k}" style="--c:${c}"><i></i>${label}<em>${n}</em></button>`).join("");

  const q = staffFilter.q.trim().toLowerCase();
  const list = staffCache.filter(s => {
    if (staffFilter.status !== "all" && stOf(s) !== staffFilter.status) return false;
    if (staffFilter.role && (s.role || "").trim() !== staffFilter.role) return false;
    if (q && !((s.name || "") + " " + (s.role || "") + " " + (s.phone || "")).toLowerCase().includes(q)) return false;
    return true;
  });

  if (!staffCache.length) {
    grid.innerHTML = `<div class="sf-empty"><div class="sf-empty-ico">${SQ(SQP.users)}</div><h3>No staff added yet</h3><p>Add waiters, chefs and cashiers to track who is in today.</p><button type="button" class="btn-primary" data-act="add">Add your first staff member</button></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="sf-empty"><div class="sf-empty-ico">${SQ(SQP.user)}</div><h3>No one matches</h3><p>Try a different name, role or status.</p><button type="button" class="btn-ghost" data-act="clear">Clear filters</button></div>`;
    return;
  }

  const weekDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    weekDays.push({ ds: dateStrOf(d), letter: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()], label: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) });
  }
  const monthPrefix = today.slice(0, 7);
  grid.innerHTML = list.map(s => staffCardHtml(s, idx, today, weekDays, monthPrefix)).join("");
}

// One set of listeners for the whole screen (cards are re-rendered often).
$("staffGrid").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) { openStaffModal(staffCache.find(s => s.id === edit.dataset.edit)); return; }
  const mark = e.target.closest("[data-mark]");
  if (mark) {
    const [staffId, status] = mark.dataset.mark.split("|");
    // tapping the active status again clears it (back to "not marked")
    markAttendance(staffId, todayStr(), statusForStaffToday(staffId) === status ? "none" : status);
    return;
  }
  const cal = e.target.closest("[data-cal]");
  if (cal) { openAttendanceCalendar(cal.dataset.cal); return; }
  const act = e.target.closest("[data-act]");
  if (act && act.dataset.act === "add") openStaffModal(null);
  if (act && act.dataset.act === "clear") {
    staffFilter = { q: "", role: "", status: "all" };
    $("staffSearchInput").value = "";
    renderStaffGrid();
  }
});
$("staffFilterChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chip]");
  if (!b) return;
  staffFilter.status = b.dataset.chip;
  renderStaffGrid();
});
$("staffSearchInput").addEventListener("input", (e) => { staffFilter.q = e.target.value; renderStaffGrid(); });
$("staffRoleFilter").addEventListener("change", (e) => { staffFilter.role = e.target.value; renderStaffGrid(); });
$("staffRoster").addEventListener("click", async (e) => {
  if (!e.target.closest("#staffMarkAllBtn")) return;
  const today = todayStr();
  const pending = staffCache.filter(s => statusForStaffToday(s.id) === "none");
  if (!pending.length) return;
  const ok = await showConfirm(`This marks ${pending.length} unmarked team member${pending.length === 1 ? "" : "s"} as present for today. You can still change anyone afterwards.`, { title: "Mark everyone present?", okLabel: "Mark present" });
  if (!ok) return;
  await Promise.all(pending.map(s => setDoc(doc(db, "restaurants", restoId, "attendance", `${s.id}_${today}`), { staffId: s.id, date: today, status: "present", markedAt: serverTimestamp() }, { merge: true })));
  toast(`${pending.length} marked present`);
});

async function markAttendance(staffId, dateStr, status) {
  await setDoc(doc(db, "restaurants", restoId, "attendance", `${staffId}_${dateStr}`), {
    staffId, date: dateStr, status, markedAt: serverTimestamp()
  }, { merge: true });
  toast(status === "none" ? "Attendance cleared" : "Attendance updated");
  if (calendarStaffId === staffId) renderAttendanceCalendar();
}

// ---- Staff add/edit modal ----
function openStaffModal(staff) {
  editingStaffId = staff ? staff.id : null;
  $("staffModalTitle").textContent = staff ? "Edit staff member" : "Add staff member";
  $("stfName").value = staff?.name || "";
  $("stfRole").value = staff?.role || "";
  $("stfPhone").value = staff?.phone || "";
  $("stfJoinDate").value = staff?.joinDate || "";
  $("stfShiftStart").value = staff?.shiftStart || "";
  $("stfShiftEnd").value = staff?.shiftEnd || "";
  $("stfNotes").value = staff?.notes || "";
  $("deleteStaffBtn").style.display = staff ? "block" : "none";
  $("staffModal").classList.remove("hidden");
  setTimeout(() => { try { $("stfName").focus(); } catch (e) { /* hidden */ } }, 50);
}
$("addStaffBtn").onclick = () => openStaffModal(null);
$("staffModalClose").onclick = () => $("staffModal").classList.add("hidden");

$("saveStaffBtn").onclick = async () => {
  const name = $("stfName").value.trim();
  if (!name) { toast("Enter a name"); return; }
  const data = {
    name,
    role: $("stfRole").value.trim(),
    phone: $("stfPhone").value.trim(),
    joinDate: $("stfJoinDate").value || "",
    shiftStart: $("stfShiftStart").value || "",
    shiftEnd: $("stfShiftEnd").value || "",
    notes: $("stfNotes").value.trim(),
  };
  if (editingStaffId) {
    await updateDoc(doc(db, "restaurants", restoId, "staff", editingStaffId), data);
  } else {
    await addDoc(collection(db, "restaurants", restoId, "staff"), { ...data, createdAt: serverTimestamp() });
  }
  $("staffModal").classList.add("hidden");
  toast("Staff member saved");
};

$("deleteStaffBtn").onclick = async () => {
  if (!editingStaffId) return;
  const ok = await showConfirm("This removes the staff member (their past attendance records stay for history).", { title: "Delete staff member?", danger: true, okLabel: "Delete" });
  if (!ok) return;
  await deleteDoc(doc(db, "restaurants", restoId, "staff", editingStaffId));
  $("staffModal").classList.add("hidden");
  toast("Staff member removed");
};

// ---- Attendance calendar modal ----
function openAttendanceCalendar(staffId) {
  calendarStaffId = staffId;
  calendarMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const s = staffCache.find(x => x.id === staffId);
  $("attendanceModalTitle").textContent = `${s?.name || "Staff"} — attendance`;
  $("attendanceModal").classList.remove("hidden");
  renderAttendanceCalendar();
}
$("attendanceModalClose").onclick = () => $("attendanceModal").classList.add("hidden");
$("attCalPrevBtn").onclick = () => { calendarMonthDate.setMonth(calendarMonthDate.getMonth() - 1); renderAttendanceCalendar(); };
$("attCalNextBtn").onclick = () => { calendarMonthDate.setMonth(calendarMonthDate.getMonth() + 1); renderAttendanceCalendar(); };

const ATT_CYCLE = ["none", "present", "halfday", "leave", "absent"];

async function renderAttendanceCalendar() {
  const y = calendarMonthDate.getFullYear(), m = calendarMonthDate.getMonth();
  $("attCalMonthLabel").textContent = calendarMonthDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const monthStart = dateStrOf(new Date(y, m, 1));
  const monthEnd = dateStrOf(new Date(y, m + 1, 0));
  const attRef = collection(db, "restaurants", restoId, "attendance");
  // Compound query (equality + range on different fields) — Firestore will
  // prompt with a one-click "create index" link in the browser console the
  // first time this runs; click it once and it works forever after.
  const snap = await getDocs(query(attRef, where("staffId", "==", calendarStaffId), where("date", ">=", monthStart), where("date", "<=", monthEnd)));
  const byDate = {};
  snap.docs.forEach(d => { const v = d.data(); byDate[v.date] = v.status; });

  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  let cells = "";
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="att-cal-cell empty"></div>`;
  const counts = { present: 0, halfday: 0, leave: 0, absent: 0 };
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = dateStrOf(new Date(y, m, day));
    const status = byDate[ds] || "none";
    if (counts.hasOwnProperty(status)) counts[status]++;
    cells += `<div class="att-cal-cell ${status} ${ds === today ? "today" : ""}" data-date="${ds}">${day}</div>`;
  }
  $("attCalGrid").innerHTML = cells;

  $("attCalGrid").querySelectorAll("[data-date]").forEach(cell => {
    cell.onclick = async () => {
      const ds = cell.dataset.date;
      const curr = byDate[ds] || "none";
      const next = ATT_CYCLE[(ATT_CYCLE.indexOf(curr) + 1) % ATT_CYCLE.length];
      byDate[ds] = next;
      await markAttendance(calendarStaffId, ds, next);
    };
  });

  $("attCalSummary").innerHTML = `
    <span><b>${counts.present}</b>Present</span>
    <span><b>${counts.halfday}</b>Half-day</span>
    <span><b>${counts.leave}</b>Leave</span>
    <span><b>${counts.absent}</b>Absent</span>`;
}

// ===================== SALES SUMMARY (profit/loss overview, payment split, top sellers) =====================
document.querySelectorAll("#salesPeriodToggle .sp-btn").forEach(b => {
  b.onclick = () => {
    salesPeriod = b.dataset.period;
    document.querySelectorAll("#salesPeriodToggle .sp-btn").forEach(x => x.classList.toggle("active", x === b));
    renderSalesSummary();
  };
});

function billDate(b) { return b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : null; }

function startOfPeriod(period) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "day") return d;
  if (period === "week") { const day = d.getDay(); const diff = (day === 0 ? 6 : day - 1); d.setDate(d.getDate() - diff); return d; } // week starts Monday
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "year") return new Date(now.getFullYear(), 0, 1);
  return d;
}

function renderSalesSummary() {
  if (!$("view-sales")) return;
  renderHistBar();
  const from = startOfPeriod(salesPeriod);
  const bills = allBills().filter(b => { const d = billDate(b); return d && d >= from; });

  const total = bills.reduce((s, b) => s + (b.total || 0), 0);
  const discount = bills.reduce((s, b) => s + (b.discount || 0), 0);
  $("salesStatTotal").textContent = money(total);
  $("salesStatBills").textContent = bills.length;
  $("salesStatAvg").textContent = money(bills.length ? total / bills.length : 0);
  $("salesStatDiscount").textContent = money(discount);

  // payment split — cash / card / upi (bills saved before this feature default to cash)
  const split = { cash: 0, card: 0, upi: 0 };
  bills.forEach(b => { const m = split.hasOwnProperty(b.paymentMode) ? b.paymentMode : "cash"; split[m] += (b.total || 0); });
  const maxSplit = Math.max(1, ...Object.values(split));
  const payIcons = { cash: "💵", card: "💳", upi: "📱" };
  $("salesPaySplit").innerHTML = ["cash", "card", "upi"].map(m => `
    <div class="pay-split-row">
      <span class="psr-label">${payIcons[m]} ${m.toUpperCase()}</span>
      <div class="psr-bar-wrap"><div class="psr-bar ${m}" style="width:${(split[m] / maxSplit * 100).toFixed(1)}%"></div></div>
      <span class="psr-amt">${money(split[m])}</span>
    </div>`).join("");

  // top 5 items by quantity sold in the period
  const qtyByName = {};
  bills.forEach(b => (b.items || []).forEach(it => { qtyByName[it.name] = (qtyByName[it.name] || 0) + (it.qty || 0); }));
  const top5 = Object.entries(qtyByName).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("salesTopItems").innerHTML = top5.length
    ? top5.map(([name, qty], idx) => `
      <div class="top-item-row">
        <span class="tir-rank">${idx + 1}</span>
        <span class="tir-name">${escapeHtml(name)}</span>
        <span class="tir-qty">${qty} sold</span>
      </div>`).join("")
    : `<div class="empty-note">No sales in this period yet.</div>`;

  renderSalesChart();
  renderPayTrends();
}

// ===================== TRADING-STYLE TREND LINE CHARTS =====================
// Buckets the whole bill history into a series of time slots matching the
// selected period toggle, so "day" compares the last 14 days against each
// other, "week" compares the last 10 weeks, etc — same idea as a stock chart.
const TREND_BUCKET_CFG = {
  day:   { count: 14, label: (d) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) },
  week:  { count: 10, label: (d) => `${d.getDate()}/${d.getMonth() + 1}` },
  month: { count: 12, label: (d) => d.toLocaleDateString("en-IN", { month: "short" }) },
  year:  { count: 6,  label: (d) => `${d.getFullYear()}` },
};

function stepDate(d, period, dir = 1) {
  const nd = new Date(d);
  if (period === "day") nd.setDate(nd.getDate() + dir);
  else if (period === "week") nd.setDate(nd.getDate() + 7 * dir);
  else if (period === "month") nd.setMonth(nd.getMonth() + dir);
  else if (period === "year") nd.setFullYear(nd.getFullYear() + dir);
  return nd;
}

// Returns an array of { label, start, end, total, cash, card, upi } buckets,
// oldest first, ending at (and including) the current period.
function buildTrendBuckets(period) {
  const cfg = TREND_BUCKET_CFG[period];
  const nowStart = startOfPeriod(period);
  const buckets = [];
  for (let i = cfg.count - 1; i >= 0; i--) {
    const start = stepDate(nowStart, period, -i);
    const end = stepDate(start, period, 1);
    buckets.push({ label: cfg.label(start), start, end, total: 0, cash: 0, card: 0, upi: 0 });
  }
  allBills().forEach(b => {
    const d = billDate(b);
    if (!d) return;
    const bucket = buckets.find(bk => d >= bk.start && d < bk.end);
    if (!bucket) return;
    bucket.total += (b.total || 0);
    const m = ["cash", "card", "upi"].includes(b.paymentMode) ? b.paymentMode : "cash";
    bucket[m] += (b.total || 0);
  });
  return buckets;
}

// Builds an SVG line/area chart from a list of numbers. Uses a viewBox whose
// aspect ratio matches how it's actually displayed (rather than stretching a
// square-ish viewBox to a wide box with preserveAspectRatio="none"), so the
// stroke, dots and everything else scale uniformly instead of smearing
// horizontally. Axis labels are rendered as real HTML underneath — SVG
// <text> inside a non-uniformly-scaled viewBox is what caused the garbled
// text before.
function buildTrendChart(values, { viewW = 600, viewH = 190, color = "var(--primary)", labels = [], id = "" } = {}) {
  const padX = viewW * 0.015;
  const padY = viewH * 0.06;
  const max = Math.max(1, ...values);
  const min = 0; // sales never go negative — anchor the baseline at zero
  const n = values.length;
  const stepX = n > 1 ? (viewW - padX * 2) / (n - 1) : 0;
  const yFor = (v) => viewH - padY - ((v - min) / (max - min || 1)) * (viewH - padY * 2);
  const points = values.map((v, i) => [padX + i * stepX, yFor(v)]);
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points[n - 1][0].toFixed(2)},${viewH - padY} L${points[0][0].toFixed(2)},${viewH - padY} Z`;
  const gradId = `trendGrad_${id || Math.random().toString(36).slice(2)}`;
  const dotR = Math.max(2, viewW * 0.006);

  const dots = points.map((p, i) => `
    <circle class="trend-dot" cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="${dotR}" fill="${color}"><title>${labels[i] || ""}: ${money(values[i])}</title></circle>`).join("");

  const svg = `
  <svg class="trend-svg" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="trend-area-path" d="${areaPath}" fill="url(#${gradId})"/>
    <path class="trend-line-path" d="${linePath}" stroke="${color}" vector-effect="non-scaling-stroke"/>
    ${dots}
  </svg>`;

  // Thin labels out on crowded charts, but keep an (invisible) slot for
  // every bucket so the flex row lines up under the chart's evenly-spaced
  // points.
  const axisHtml = labels.length ? `<div class="trend-axis-row">${
    labels.map((l, i) => {
      const show = n <= 8 || i % Math.ceil(n / 7) === 0 || i === n - 1;
      return `<span class="trend-axis-item${show ? "" : " skip"}">${l}</span>`;
    }).join("")
  }</div>` : "";

  return svg + axisHtml;
}

function buildColumnChart(values, labels = []) {
  const n = values.length, max = Math.max(1, ...values);
  const pal = ["#1B5E4A", "#0E7C7B", "#D9A21B", "#1C8A4B", "#58384F", "#2F6FB5", "#B8472B"];
  const short = (v) => v >= 100000 ? (v / 100000).toFixed(1).replace(/\.0$/, "") + "L" : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(v));
  const grid = [100, 75, 50, 25, 0].map(p => `<span style="bottom:${p}%"><i>₹${short(max * p / 100)}</i></span>`).join("");
  const cols = values.map((v, i) => {
    const showLab = n <= 12 || i % Math.ceil(n / 10) === 0 || i === n - 1;
    return `<div class="cc-col${i === n - 1 ? " now" : ""}" title="${labels[i] || ""}: ${money(v)}">
      <div class="cc-track"><div class="cc-bar" style="height:${v > 0 ? Math.max(v / max * 100, 2) : 0}%;--c:${pal[i % pal.length]};animation-delay:${i * 28}ms"><em>${v > 0 ? "₹" + short(v) : ""}</em></div></div>
      <span class="cc-lab">${showLab ? (labels[i] || "") : ""}</span></div>`;
  }).join("");
  return `<div class="col-chart${n > 14 ? " dense" : ""}"><div class="cc-grid">${grid}</div><div class="cc-bars">${cols}</div></div>`;
}

function pctChange(curr, prev) {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}
function trendDirClass(pct) { return pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat"; }
function trendArrow(pct) { return pct > 0.5 ? "▲" : pct < -0.5 ? "▼" : "▬"; }

function renderSalesChart() {
  const buckets = buildTrendBuckets(salesPeriod);
  const values = buckets.map(b => b.total);
  const labels = buckets.map(b => b.label);
  const hasAny = values.some(v => v > 0);

  if (!hasAny) {
    $("salesChartWrap").innerHTML = `<div class="trend-empty">No sales yet to chart for this period.</div>`;
    $("salesTrendBadge").textContent = "";
    $("salesTrendBadge").className = "trend-badge";
    return;
  }

  $("salesChartWrap").innerHTML = buildColumnChart(values, labels);

  const curr = values[values.length - 1];
  const prev = values[values.length - 2] ?? 0;
  const pct = pctChange(curr, prev);
  const badge = $("salesTrendBadge");
  badge.className = `trend-badge ${trendDirClass(pct)}`;
  badge.textContent = `${trendArrow(pct)} ${Math.abs(pct).toFixed(1)}% vs previous ${salesPeriod}`;
}

function renderPayTrends() {
  const buckets = buildTrendBuckets(salesPeriod);
  const modes = [
    { key: "cash", label: "💵 Cash", color: "var(--green)" },
    { key: "card", label: "💳 Card", color: "var(--teal)" },
    { key: "upi", label: "📱 UPI", color: "var(--primary)" },
  ];
  $("salesPayTrends").innerHTML = modes.map(m => {
    const values = buckets.map(b => b[m.key]);
    const curr = values[values.length - 1];
    const prev = values[values.length - 2] ?? 0;
    const pct = pctChange(curr, prev);
    return `
    <div class="mini-trend-card">
      <div class="mtc-top">
        <span class="mtc-label">${m.label}</span>
        <span class="mtc-change ${trendDirClass(pct)}">${trendArrow(pct)} ${Math.abs(pct).toFixed(0)}%</span>
      </div>
      <div class="mtc-amt">${money(curr)}</div>
      <div class="mtc-spark">${buildTrendChart(values, { viewW: 300, viewH: 60, color: m.color, id: m.key })}</div>
    </div>`;
  }).join("");
}

// ===================== ORDER TAKING / MENU PICKER (PetPooja-style: category boxes → item boxes) =====================
$("menuSearchInput").oninput = renderMenuPicker;
$("menuBackBtn").onclick = () => { activeCategory = null; $("menuSearchInput").value = ""; renderMenuPicker(); };

function renderMenuPicker() {
  const search = $("menuSearchInput").value.trim().toLowerCase();
  const available = menuCache.filter(i => i.available !== false);
  const catGrid = $("menuCatGrid");
  const itemGrid = $("menuPickGrid");
  const crumb = $("menuBreadcrumb");

  if (search) {
    // Search overrides category browsing — show matching items from every category.
    catGrid.classList.add("hidden");
    crumb.classList.remove("hidden");
    $("menuBreadcrumbTitle").textContent = `Search results for "${$("menuSearchInput").value.trim()}"`;
    renderItemBoxes(available.filter(i => i.name.toLowerCase().includes(search)));
    return;
  }

  if (!activeCategory) {
    // Landing view: coloured category boxes, PetPooja-style.
    itemGrid.classList.add("hidden");
    crumb.classList.add("hidden");
    catGrid.classList.remove("hidden");
    const cats = [...new Set(available.map(i => i.category).filter(Boolean))];
    if (!cats.length) { catGrid.innerHTML = `<div class="empty-note">No items found. Add items in Menu Builder.</div>`; return; }
    catGrid.innerHTML = cats.map((c, idx) => {
      const count = available.filter(i => i.category === c).length;
      const art = catArt(c);
      return `
      <button type="button" class="cat-box" data-cat="${escapeHtml(c)}" style="background:${art.a};--g1:${art.a};--g2:${art.b};">
        <span class="cat-art" aria-hidden="true"><i class="a1">${art.e[0]}</i><i class="a2">${art.e[1]}</i><i class="a3">${art.e[2]}</i></span>
        <span class="cat-box-ico">${catIcon(c)}</span>
        <div class="cat-box-text">
          <div class="cat-box-name">${escapeHtml(c)}</div>
          <div class="cat-box-count">${count} item${count === 1 ? "" : "s"}</div>
        </div>
      </button>`;
    }).join("");
    catGrid.querySelectorAll(".cat-box").forEach(b => applyCatPhoto(b, b.dataset.cat));
    catGrid.querySelectorAll(".cat-box").forEach(b => {
      b.onclick = () => { activeCategory = b.dataset.cat; renderMenuPicker(); };
    });
    return;
  }

  // Drilled into one category.
  catGrid.classList.add("hidden");
  crumb.classList.remove("hidden");
  $("menuBreadcrumbTitle").textContent = activeCategory;
  renderItemBoxes(available.filter(i => i.category === activeCategory));
}

function renderItemBoxes(items) {
  const grid = $("menuPickGrid");
  grid.classList.remove("hidden");
  if (!items.length) { grid.innerHTML = `<div class="empty-note">No items found.</div>`; return; }
  grid.innerHTML = items.map(i => `
    <div class="pick-box" data-id="${i.id}">
      <div class="pick-box-top">
        <span class="veg-mark ${i.veg === "nonveg" ? "nonveg" : "veg"}"><span></span></span>
        ${i.addons?.length ? `<span class="pick-box-addon">${i.addons.length} add-on${i.addons.length === 1 ? "" : "s"}</span>` : ""}
      </div>
      <div class="pr-name">${escapeHtml(i.name)}</div>
      <div class="pick-box-bottom">
        <div class="pr-price">${i.variants?.length ? "from " + money(Math.min(...i.variants.map(v => v.price))) : money(i.basePrice)}</div>
        <div class="pr-ctl" data-q="${staffCartQtyForItem(i.id)}">${pickCtlHtml(i)}</div>
      </div>
    </div>`).join("");
  grid.querySelectorAll(".pick-box").forEach(box => box.classList.toggle("in-cart", staffCartQtyForItem(box.dataset.id) > 0));
  // One delegated handler: +/− quick-adjust the quantity; tapping the tile itself opens the options/notes modal.
  grid.onclick = (e) => {
    const box = e.target.closest ? e.target.closest(".pick-box") : null;
    if (!box) return;
    const step = e.target.closest(".pr-step");
    if (step) { e.stopPropagation(); staffAdjustItem(box.dataset.id, parseInt(step.dataset.d, 10)); return; }
    const item = menuCache.find(i => i.id === box.dataset.id);
    if (item) openPickModal(item);
  };
}

function pickCtlHtml(i) {
  const q = staffCartQtyForItem(i.id);
  const nm = escapeHtml(i.name);
  if (!q) return `<button type="button" class="pr-arrow pr-step" data-d="1" aria-label="Add ${nm}">+</button>`;
  return `<div class="pr-stepper"><button type="button" class="pr-step" data-d="-1" aria-label="Remove one ${nm}">−</button><b>${q}</b><button type="button" class="pr-step" data-d="1" aria-label="Add one more ${nm}">+</button></div>`;
}
// keep tile steppers in sync with the cart without re-rendering the grid (keeps scroll position)
function updatePickSteppers() {
  const grid = $("menuPickGrid");
  if (!grid) return;
  grid.querySelectorAll(".pick-box").forEach(box => {
    const i = menuCache.find(m => m.id === box.dataset.id);
    const host = box.querySelector(".pr-ctl");
    if (!i || !host) return;
    const q = staffCartQtyForItem(i.id);
    if (host.dataset.q === String(q)) return;
    host.dataset.q = String(q);
    host.innerHTML = pickCtlHtml(i);
    box.classList.toggle("in-cart", q > 0);
  });
}
// +1 / −1 for an item straight from its menu tile
function staffAdjustItem(itemId, d) {
  const item = menuCache.find(i => i.id === itemId);
  if (!item) return;
  const hasOptions = (item.variants && item.variants.length) || (item.addons && item.addons.length);
  const lines = cart.filter(c => c.itemId === itemId);
  if (d > 0) {
    if (!lines.length) {
      if (hasOptions) { openPickModal(item); return; }   // needs a variant/add-on choice first
      const price = item.basePrice || 0;
      cart.push({ itemId: item.id, name: item.name, variant: null, addons: [], notes: "", qty: 1, unitPrice: price, lineTotal: price, printed: false });
      renderCart();
      maybeShowUpsellStaff(item);
      return;
    }
    if (hasOptions && lines.length > 1) { openPickModal(item); return; }  // several variants in cart: choose which
    const c = lines[lines.length - 1];
    const unit = c.unitPrice ?? c.lineTotal / c.qty;
    if (c.printed) cart.push({ ...c, qty: 1, unitPrice: unit, lineTotal: unit, printed: false });  // kitchen already has this line → new KOT line
    else { c.qty += 1; c.unitPrice = unit; c.lineTotal = unit * c.qty; }
  } else {
    const c = lines[lines.length - 1];
    if (!c) return;
    if (c.qty <= 1) cart.splice(cart.indexOf(c), 1);
    else { const unit = c.unitPrice ?? c.lineTotal / c.qty; c.qty -= 1; c.unitPrice = unit; c.lineTotal = unit * c.qty; }
  }
  renderCart();
}

let pickSelectedVariant = null;
let pickSelectedAddons = [];

function openPickModal(item) {
  pickingItem = item;
  pickSelectedVariant = item.variants?.length ? item.variants[0] : null;
  pickSelectedAddons = [];
  $("pickModalTitle").textContent = item.name;
  $("pickQty").value = 1;
  $("pickNotes").value = "";

  if (item.variants?.length) {
    $("pickVariantSection").classList.remove("hidden");
    $("pickVariantOptions").innerHTML = item.variants.map((v, idx) =>
      `<div class="chip ${idx === 0 ? "selected" : ""}" data-idx="${idx}">${v.name} · ${money(v.price)}</div>`).join("");
    $("pickVariantOptions").querySelectorAll(".chip").forEach(ch => {
      ch.onclick = () => {
        $("pickVariantOptions").querySelectorAll(".chip").forEach(c => c.classList.remove("selected"));
        ch.classList.add("selected");
        pickSelectedVariant = item.variants[ch.dataset.idx];
      };
    });
  } else {
    $("pickVariantSection").classList.add("hidden");
  }

  if (item.addons?.length) {
    $("pickAddonSection").classList.remove("hidden");
    $("pickAddonOptions").innerHTML = item.addons.map((a, idx) =>
      `<div class="chip" data-idx="${idx}">${a.name} · +${money(a.price)}</div>`).join("");
    $("pickAddonOptions").querySelectorAll(".chip").forEach(ch => {
      ch.onclick = () => {
        ch.classList.toggle("selected");
        const a = item.addons[ch.dataset.idx];
        if (ch.classList.contains("selected")) pickSelectedAddons.push(a);
        else pickSelectedAddons = pickSelectedAddons.filter(x => x.name !== a.name);
      };
    });
  } else {
    $("pickAddonSection").classList.add("hidden");
  }

  $("pickModal").classList.remove("hidden");
}
$("pickModalClose").onclick = () => $("pickModal").classList.add("hidden");
$("pickQtyMinus").onclick = () => { $("pickQty").value = Math.max(1, (parseInt($("pickQty").value) || 1) - 1); };
$("pickQtyPlus").onclick = () => { $("pickQty").value = Math.min(999, (parseInt($("pickQty").value) || 1) + 1); };

$("pickAddBtn").onclick = () => {
  const qty = Math.max(1, parseInt($("pickQty").value) || 1);
  const basePrice = pickSelectedVariant ? pickSelectedVariant.price : pickingItem.basePrice;
  const addonsTotal = pickSelectedAddons.reduce((s, a) => s + a.price, 0);
  const addedItem = pickingItem;
  cart.push({
    itemId: pickingItem.id,
    name: pickingItem.name,
    variant: pickSelectedVariant ? pickSelectedVariant.name : null,
    addons: pickSelectedAddons.map(a => a.name),
    notes: $("pickNotes").value.trim(),
    qty,
    unitPrice: basePrice + addonsTotal,
    lineTotal: (basePrice + addonsTotal) * qty,
    printed: false
  });
  $("pickModal").classList.add("hidden");
  renderCart();
  maybeShowUpsellStaff(addedItem);
};

// ===================== STAFF-SIDE UPSELL SUGGESTIONS =====================
// Mirrors the customer QR ordering upsell (order.js): after staff add an
// item that has upsellIds configured in the Menu Builder, nudge them with
// a one-tap "goes great together" card so table-side suggestions aren't
// only a QR-ordering thing. Shown once per triggering item per table visit.
function staffCartQtyForItem(itemId) {
  return cart.filter(c => c.itemId === itemId).reduce((s, c) => s + (c.qty || 0), 0);
}
let staffUpsellAutoHideTimer = null;
function maybeShowUpsellStaff(triggerItem) {
  if (!triggerItem?.upsellIds?.length || staffUpsellShownFor.has(triggerItem.id)) return;
  const suggestions = triggerItem.upsellIds
    .map(id => menuCache.find(m => m.id === id))
    .filter(m => m && m.available !== false && staffCartQtyForItem(m.id) === 0);
  if (!suggestions.length) return;
  staffUpsellShownFor.add(triggerItem.id);
  showUpsellPromptStaff(suggestions);
}
function showUpsellPromptStaff(items) {
  $("staffUpsellItems").innerHTML = items.map(i => `
    <div class="staff-upsell-item" data-id="${i.id}">
      <div>
        <div class="staff-upsell-item-name">${escapeHtml(i.name)}</div>
        <div class="staff-upsell-item-price">${i.variants?.length ? "From " + money(Math.min(...i.variants.map(v => v.price))) : money(i.basePrice || 0)}</div>
      </div>
      <button class="staff-upsell-add-btn" data-id="${i.id}">+ Add</button>
    </div>`).join("");
  $("staffUpsellItems").querySelectorAll(".staff-upsell-add-btn").forEach(btn => {
    btn.onclick = () => {
      const item = menuCache.find(m => m.id === btn.dataset.id);
      if (!item) return;
      if (item.variants?.length || item.addons?.length) { hideUpsellPromptStaff(); openPickModal(item); return; }
      cart.push({
        itemId: item.id, name: item.name, variant: null, addons: [], notes: "",
        qty: 1, unitPrice: item.basePrice || 0, lineTotal: item.basePrice || 0, printed: false
      });
      renderCart();
      btn.textContent = "✓ Added";
      btn.disabled = true;
      btn.closest(".staff-upsell-item").classList.add("added");
    };
  });
  $("staffUpsellPrompt").classList.remove("hidden");
  requestAnimationFrame(() => $("staffUpsellPrompt").classList.add("shown"));
  clearTimeout(staffUpsellAutoHideTimer);
  staffUpsellAutoHideTimer = setTimeout(hideUpsellPromptStaff, 8000);
}
function hideUpsellPromptStaff() {
  clearTimeout(staffUpsellAutoHideTimer);
  const el = $("staffUpsellPrompt");
  if (!el) return;
  el.classList.remove("shown");
  setTimeout(() => el.classList.add("hidden"), 250);
}
// Synchronous reset (no animation) for when a new table/seat order opens —
// avoids a race where a delayed hide from the previous table could land
// after a suggestion card for the new table has already started showing.
function resetUpsellStaffUI() {
  clearTimeout(staffUpsellAutoHideTimer);
  const el = $("staffUpsellPrompt");
  if (!el) return;
  el.classList.remove("shown");
  el.classList.add("hidden");
}
if ($("staffUpsellCloseBtn")) $("staffUpsellCloseBtn").onclick = hideUpsellPromptStaff;

function renderOrderTypeToggle() {
  document.querySelectorAll("#orderTypeToggle .ot-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.ordertype === orderType);
  });
}
document.querySelectorAll("#orderTypeToggle .ot-btn").forEach(b => {
  b.onclick = () => { orderType = b.dataset.ordertype; renderOrderTypeToggle(); };
});

function renderPaymentModeToggle() {
  document.querySelectorAll("#payModeToggle .pm-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.paymode === paymentMode);
  });
}
document.querySelectorAll("#payModeToggle .pm-btn").forEach(b => {
  b.onclick = () => { paymentMode = b.dataset.paymode; renderPaymentModeToggle(); };
});

function renderCart() {
  const list = $("cartList");
  if (!cart.length) { list.innerHTML = `<div class="empty-note" style="color:#9C9384;">No items yet — tap a menu item to add.</div>`; }
  else {
    list.innerHTML = cart.map((c, idx) => `
      <div class="cart-item">
        <div class="ci-main">
          <div class="ci-name">${escapeHtml(c.name)}${c.variant ? ` <span class="ci-var">${escapeHtml(c.variant)}</span>` : ""}</div>
          <div class="ci-meta">${money(c.unitPrice ?? c.lineTotal / c.qty)} each${c.addons?.length ? " · + " + escapeHtml(addonNames(c.addons)) : ""}${c.notes ? " · " + escapeHtml(c.notes) : ""}</div>
        </div>
        <div class="ci-qty">
          <button type="button" class="ci-step" data-idx="${idx}" data-d="-1" aria-label="Decrease quantity">−</button>
          <b>${c.qty}</b>
          <button type="button" class="ci-step" data-idx="${idx}" data-d="1" aria-label="Increase quantity">+</button>
        </div>
        <div class="ci-price">${money(c.lineTotal)}</div>
        <button type="button" class="cart-item-x" data-idx="${idx}" aria-label="Remove item" title="Remove item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>
      </div>`).join("");
    list.querySelectorAll(".cart-item-x").forEach(b => {
      b.onclick = () => { cart.splice(parseInt(b.dataset.idx), 1); renderCart(); };
    });
    list.querySelectorAll(".ci-step").forEach(b => {
      b.onclick = () => {
        const i = parseInt(b.dataset.idx), d = parseInt(b.dataset.d), c = cart[i];
        if (!c) return;
        const unit = c.unitPrice ?? c.lineTotal / c.qty;
        if (d > 0 && c.printed) {
          // kitchen already has this line — add the extra as a fresh line so a new KOT is sent
          cart.push({ ...c, qty: 1, unitPrice: unit, lineTotal: unit, printed: false });
        } else if (c.qty + d < 1) {
          cart.splice(i, 1);
        } else {
          c.qty += d; c.unitPrice = unit; c.lineTotal = unit * c.qty;
        }
        renderCart();
      };
    });
  }
  const subtotal = cart.reduce((s, c) => s + c.lineTotal, 0);
  const cgstPct = restoData.cgstPct ?? 2.5, sgstPct = restoData.sgstPct ?? 2.5;
  const discount = Math.max(0, parseFloat($("cartDiscount").value) || 0);
  const taxable = Math.max(subtotal - discount, 0);
  const cgst = taxable * cgstPct / 100;
  const sgst = taxable * sgstPct / 100;
  const total = taxable + cgst + sgst;

  $("cgstLabel").textContent = `CGST (${cgstPct}%)`;
  $("sgstLabel").textContent = `SGST (${sgstPct}%)`;
  $("cartSubtotal").textContent = money(subtotal);
  $("cartCgst").textContent = money(cgst);
  $("cartSgst").textContent = money(sgst);
  $("cartTotal").textContent = money(total);

  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
  $("mcbCount").textContent = itemCount + (itemCount === 1 ? " item" : " items");
  $("mcbTotal").textContent = money(total);
  updatePickSteppers();
}
$("cartDiscount").oninput = renderCart;

// Save order (KOT) — persists cart against this seat group without billing yet
$("saveOrderBtn").onclick = async () => {
  if (!cart.length) { toast("Add items first"); return; }
  const custName = $("orderCustName").value.trim();
  const custPhone = $("orderCustPhone").value.trim();

  // only print items that haven't already been sent to the kitchen — avoids
  // reprinting the whole ticket (and confusing the kitchen) on every edit
  const newItems = cart.filter(c => !c.printed);
  cart = cart.map(c => ({ ...c, printed: true }));

  const payload = {
    tableId: activeTable.id, tableName: activeTable.name, seatLabels: activeSeatLabels,
    items: cart, status: "open", orderType, paymentMode,
    customerName: custName, customerPhone: custPhone,
    updatedAt: serverTimestamp()
  };
  // new items sent to the kitchen should pull the ticket back to the front
  // of the queue, even if it was already marked preparing/ready/served
  if (newItems.length) { payload.kitchenStatus = "new"; payload.kdsUpdatedAt = serverTimestamp(); payload.kdsCleared = false; }

  if (currentOrder?.id) {
    await updateDoc(doc(db, "restaurants", restoId, "orders", currentOrder.id), payload);
    if (newItems.length) syncCustomerOrderStatus(currentOrder.id, { kitchenStatus: "new", kdsCleared: false });
  } else {
    payload.createdAt = serverTimestamp();
    payload.kitchenStatus = "new";
    payload.kdsUpdatedAt = serverTimestamp();
    const ref = await addDoc(collection(db, "restaurants", restoId, "orders"), payload);
    currentOrder = { id: ref.id, ...payload };
  }
  renderCart();
  if (newItems.length) await printKOT(newItems, `${activeTable.name} ${seatLabelsText(activeSeatLabels)}`);
  else toast("Order saved");
  showView("tables");
};

// ---------- Transfer table & split bill (added) ----------
function ensureToolModal() {
  let m = document.getElementById("toolModal");
  if (m) return m;
  m = document.createElement("div");
  m.id = "toolModal"; m.className = "modal hidden";
  m.innerHTML = '<div class="modal-card"><div class="modal-head"><h2 id="toolTitle"></h2><button class="modal-x" id="toolClose">×</button></div><div id="toolBody"></div></div>';
  document.body.appendChild(m);
  m.onclick = (e) => { if (e.target === m) m.classList.add("hidden"); };
  m.querySelector("#toolClose").onclick = () => m.classList.add("hidden");
  return m;
}
$("transferTableBtn").onclick = () => {
  if (!activeTable) return;
  const m = ensureToolModal(), body = $("toolBody");
  $("toolTitle").textContent = "Transfer table";
  let target = null, picked = [];
  const draw = () => {
    if (!target) {
      body.innerHTML = `<p class="tool-help">Move <b>${escapeHtml(activeTable.name)} · Seat ${seatLabelsText(activeSeatLabels)}</b> to another table.</p>
        <div class="xfer-grid">${tablesCache.map(t => `<button type="button" class="xfer-table${t.id === activeTable.id ? " current" : ""}" data-id="${t.id}">${escapeHtml(t.name)}</button>`).join("")}</div>`;
      body.querySelectorAll(".xfer-table").forEach(b => b.onclick = () => { target = tablesCache.find(t => t.id === b.dataset.id); picked = []; draw(); });
      return;
    }
    const occ = seatOccupancyMap(target.id), mine = currentOrder?.id;
    body.innerHTML = `<p class="tool-help">Pick seat(s) at <b>${escapeHtml(target.name)}</b>.</p>
      <div class="seat-chip-grid">${seatLettersFor(target).map(l => {
        const o = occ[l], taken = o && o.id !== mine;
        return `<button type="button" class="seat-chip ${taken ? "taken" : picked.includes(l) ? "selected" : ""}" data-seat="${l}" ${taken ? "disabled" : ""}><span class="seat-letter">${l.toUpperCase()}</span><span class="seat-sub">${taken ? "occupied" : picked.includes(l) ? "selected" : "free"}</span></button>`;
      }).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn-ghost" id="xferBack">Back</button><button type="button" class="btn-primary" id="xferGo" ${picked.length ? "" : "disabled"}>Move here</button></div>`;
    body.querySelectorAll(".seat-chip:not(.taken)").forEach(b => b.onclick = () => {
      const l = b.dataset.seat; picked = picked.includes(l) ? picked.filter(x => x !== l) : [...picked, l]; draw();
    });
    $("xferBack").onclick = () => { target = null; draw(); };
    $("xferGo").onclick = async () => {
      if (!picked.length) return;
      if (currentOrder?.id) {
        await updateDoc(doc(db, "restaurants", restoId, "orders", currentOrder.id), { tableId: target.id, tableName: target.name, seatLabels: picked, updatedAt: serverTimestamp() });
        currentOrder = { ...currentOrder, tableId: target.id, tableName: target.name, seatLabels: picked };
      }
      activeTable = target; activeSeatLabels = picked;
      $("orderTableName").textContent = `${target.name} · Seat${picked.length > 1 ? "s" : ""} ${seatLabelsText(picked)}`;
      m.classList.add("hidden");
      toast(`Moved to ${target.name}`);
    };
  };
  draw();
  m.classList.remove("hidden");
};
$("splitBillBtn").onclick = () => {
  if (!cart.length) { toast("Add items first"); return; }
  const m = ensureToolModal(), body = $("toolBody");
  $("toolTitle").textContent = "Split bill equally";
  const total = parseFloat($("cartTotal").textContent.replace(/[^0-9.]/g, "")) || 0;
  let n = 2;
  const draw = () => {
    body.innerHTML = `<p class="tool-help">Bill total <b>${money(total)}</b> shared between:</p>
      <div class="split-ctl"><button type="button" id="spMinus">−</button><b>${n}</b><button type="button" id="spPlus">+</button><span>people</span></div>
      <div class="split-result"><span>Each person pays</span><b>${money(Math.ceil(total / n * 100) / 100)}</b></div>`;
    $("spMinus").onclick = () => { n = Math.max(2, n - 1); draw(); };
    $("spPlus").onclick = () => { n = Math.min(20, n + 1); draw(); };
  };
  draw();
  m.classList.remove("hidden");
};

// ===================== CUSTOM PRINT ENGINE =====================
// Your own print pipeline: instead of relying on Chrome's print dialog
// defaults (which reset margins/scale/paper size unpredictably), we render
// the bill into a dedicated, minimal print window whose CSS @page rule is
// built exactly from the user's saved paper settings. The OS print dialog
// still appears (no web page can fully suppress it), but every field in it —
// paper size, margins, scale — is already correct, so it's a single click.
const PRINT_PRESETS = {
  roll80: { label: "80mm thermal roll", width: 80, height: null },
  roll58: { label: "58mm thermal roll", width: 58, height: null },
  card4x6: { label: "4 × 6 inch", width: 101.6, height: 152.4 },
  a4half: { label: "A4 half page", width: 148, height: 210 },
  custom: { label: "Custom size", width: 80, height: null }
};

function getPrintSettings() {
  const p = restoData.printSettings || {};
  const preset = PRINT_PRESETS[p.preset] ? p.preset : "roll80";
  return {
    preset,
    widthMm: p.widthMm || PRINT_PRESETS[preset].width,
    heightMm: p.heightMm != null ? p.heightMm : PRINT_PRESETS[preset].height,
    marginMm: p.marginMm != null ? p.marginMm : 2,
    scale: p.scale || 100,
    copies: p.copies || 1
  };
}

// Builds a standalone HTML document sized exactly to the given paper.
// height=null means "continuous roll" — we let the page grow with content
// (Chrome/Edge support `size: <w>mm auto`).
function buildPrintDocument(innerHTML, settings) {
  const { widthMm, heightMm, marginMm, scale } = settings;
  const pageSize = heightMm ? `${widthMm}mm ${heightMm}mm` : `${widthMm}mm auto`;
  const scaleFactor = (scale || 100) / 100;
  const contentWidthMm = Math.max(10, widthMm - marginMm * 2);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      @page{ size:${pageSize}; margin:${marginMm}mm; }
      *{box-sizing:border-box;}
      html,body{margin:0;padding:0;}
      body{
        font-family:'Courier New',monospace;width:${contentWidthMm}mm;
        font-size:${12 * scaleFactor}px;line-height:1.5;color:#000;
      }
      .thermal-bill{font-family:'Courier New',monospace;font-size:inherit;width:100%;margin:0;padding:0;border:0;background:#fff;line-height:1.5;}
      .tb-center{text-align:center;}
      .tb-title{font-weight:700;font-size:${14 * scaleFactor}px;}
      .tb-meta,.tb-note{font-size:${10.5 * scaleFactor}px;}
      .tb-note{color:#777;margin-top:${6 * scaleFactor}px;}
      .tb-addons{font-size:${10.5 * scaleFactor}px;color:#555;padding-left:8px;}
      .tb-total{font-size:${14 * scaleFactor}px;}
      hr{border:none;border-top:1px dashed #000;margin:${8 * scaleFactor}px 0;}
      .tb-row{display:flex;justify-content:space-between;gap:6px;}
      .tb-item-name{flex:1;}
      .tb-bold{font-weight:700;}
    </style></head>
    <body><div class="thermal-bill">${innerHTML}</div></body></html>`;
}

// Opens the print-only window, writes the sized document, waits for it to
// paint, then invokes print() — repeated once per requested copy.
function openCustomPrintWindow(innerHTML, settings) {
  const w = window.open("", "_blank", "width=420,height=680");
  if (!w) { toast("Allow popups to print"); return; }
  const copies = Math.max(1, settings.copies || 1);
  const doc = buildPrintDocument(
    copies > 1 ? Array(copies).fill(innerHTML).join('<div style="page-break-after:always;"></div>') : innerHTML,
    settings
  );
  w.document.open();
  w.document.write(doc);
  w.document.close();
  w.onload = () => {
    setTimeout(() => { w.print(); }, 200);
  };
}

function populatePrintSettingsUI() {
  const s = getPrintSettings();
  $("ppPreset").value = s.preset;
  $("ppWidth").value = s.widthMm;
  $("ppHeight").value = s.heightMm ?? "";
  $("ppMargin").value = s.marginMm;
  $("ppScale").value = s.scale;
  $("ppCopies").value = s.copies;
  updatePresetHint();
}

function updatePresetHint() {
  const preset = $("ppPreset").value;
  const isCustom = preset === "custom";
  $("ppWidth").disabled = !isCustom;
  $("ppHeight").disabled = !isCustom;
  if (!isCustom) {
    $("ppWidth").value = PRINT_PRESETS[preset].width;
    $("ppHeight").value = PRINT_PRESETS[preset].height ?? "";
  }
  $("ppresetHint").textContent = PRINT_PRESETS[preset].height
    ? `Fixed page: ${PRINT_PRESETS[preset].width} × ${PRINT_PRESETS[preset].height}mm.`
    : `Continuous roll — page grows to fit the bill length automatically.`;
}
$("ppPreset").onchange = updatePresetHint;

$("savePrintSettingsBtn").onclick = async () => {
  const preset = $("ppPreset").value;
  const printSettings = {
    preset,
    widthMm: parseFloat($("ppWidth").value) || PRINT_PRESETS[preset].width,
    heightMm: $("ppHeight").value !== "" ? parseFloat($("ppHeight").value) : null,
    marginMm: parseFloat($("ppMargin").value) || 0,
    scale: parseInt($("ppScale").value) || 100,
    copies: parseInt($("ppCopies").value) || 1
  };
  await setDoc(doc(db, "restaurants", restoId), { printSettings }, { merge: true });
  restoData = { ...restoData, printSettings };
  toast("Print settings saved");
};

// ===================== KOT PRINTER (Bluetooth ESC/POS) =====================
// Connects directly to cheap 58mm/80mm BLE thermal printers (the kind sold for
// ~₹2000-4000 on Amazon/Flipkart for kitchen use) using raw ESC/POS commands.
// No paid API, no local software — works straight from the browser.
let kotPrinterDevice = null;
let kotPrinterChar = null;

// Two common GATT service/characteristic pairs cover the vast majority of
// cheap Chinese ESC/POS BLE printers in the market.
const KOT_PRINTER_PROFILES = [
  { service: "000018f0-0000-1000-8000-00805f9b34fb", char: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", char: "49535343-8841-43f4-a8d4-ecbe34729bb3" }
];

function buildKOTBytes(items, tableName) {
  const enc = new TextEncoder();
  const ESC = 0x1b, GS = 0x1d;
  const parts = [];
  const push = (u8) => parts.push(u8);
  push(new Uint8Array([ESC, 0x40])); // init
  push(new Uint8Array([ESC, 0x61, 1])); // center
  push(new Uint8Array([ESC, 0x21, 0x30])); // double size
  push(enc.encode("KOT\n"));
  push(new Uint8Array([ESC, 0x21, 0x00])); // normal size
  push(new Uint8Array([ESC, 0x61, 0])); // left align
  push(enc.encode(`Table: ${tableName}\n`));
  push(enc.encode(`${new Date().toLocaleString("en-IN")}\n`));
  push(enc.encode("--------------------------------\n"));
  items.forEach(it => {
    push(new Uint8Array([ESC, 0x21, 0x08])); // bold
    push(enc.encode(`${it.qty}x ${it.name}${it.variant ? " (" + it.variant + ")" : ""}\n`));
    push(new Uint8Array([ESC, 0x21, 0x00])); // normal
    if (it.addons?.length) push(enc.encode(`   + ${addonNames(it.addons)}\n`));
    if (it.notes) push(enc.encode(`   note: ${it.notes}\n`));
  });
  push(enc.encode("--------------------------------\n\n\n"));
  push(new Uint8Array([GS, 0x56, 0x42, 0x00])); // partial cut (ignored if unsupported)
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach(p => { out.set(p, off); off += p.length; });
  return out;
}

async function connectKotPrinter() {
  if (!navigator.bluetooth) {
    toast("Bluetooth printing needs Chrome or Edge (desktop/Android)");
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KOT_PRINTER_PROFILES.map(p => p.service)
    });
    const server = await device.gatt.connect();
    let char = null;
    for (const profile of KOT_PRINTER_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        char = await service.getCharacteristic(profile.char);
        break;
      } catch { /* try next profile */ }
    }
    if (!char) throw new Error("Printer doesn't expose a supported print service");
    kotPrinterDevice = device;
    kotPrinterChar = char;
    device.addEventListener("gattserverdisconnected", () => {
      kotPrinterDevice = null; kotPrinterChar = null; updatePrinterStatusUI();
      toast("Kitchen printer disconnected");
    });
    updatePrinterStatusUI();
    toast(`Connected to ${device.name || "printer"}`);
  } catch (err) {
    if (err.name !== "NotFoundError") toast("Printer connection failed: " + err.message);
  }
}

function disconnectKotPrinter() {
  if (kotPrinterDevice?.gatt?.connected) kotPrinterDevice.gatt.disconnect();
  kotPrinterDevice = null; kotPrinterChar = null;
  updatePrinterStatusUI();
}

async function sendToKotPrinter(bytes) {
  if (!kotPrinterChar) return false;
  const CHUNK = 180; // BLE write size limit on most cheap printers
  try {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      await kotPrinterChar.writeValueWithoutResponse(bytes.slice(i, i + CHUNK));
    }
    return true;
  } catch (err) {
    toast("Print failed: " + err.message);
    return false;
  }
}

function updatePrinterStatusUI() {
  const el = $("kotPrinterStatus");
  if (!el) return;
  const connected = !!kotPrinterDevice;
  el.textContent = connected ? `Connected: ${kotPrinterDevice.name || "Printer"}` : "Not connected";
  el.classList.toggle("connected", connected);
  const discBtn = $("disconnectPrinterBtn");
  if (discBtn) discBtn.style.display = connected ? "inline-flex" : "none";
  updateSettingsStatusStrip();
}

function openKotFallbackWindow(items, tableName) {
  const rows = items.map(it => `
    <div style="margin-bottom:6px;">
      <div class="tb-bold">${it.qty}x ${it.name}${it.variant ? " (" + it.variant + ")" : ""}</div>
      ${it.addons?.length ? `<div style="font-size:11px;padding-left:10px;">+ ${addonNames(it.addons)}</div>` : ""}
      ${it.notes ? `<div style="font-size:11px;padding-left:10px;font-style:italic;">note: ${it.notes}</div>` : ""}
    </div>`).join("");
  const inner = `
    <div class="tb-center tb-title">KOT</div>
    <div>Table: ${tableName}</div>
    <div>${new Date().toLocaleString("en-IN")}</div>
    <hr>${rows}<hr>`;
  // KOT tickets always go on the kitchen's roll paper — same width as the
  // saved bill settings, but always continuous (never a fixed-height card).
  const base = getPrintSettings();
  openCustomPrintWindow(inner, { ...base, heightMm: null, copies: 1 });
}

async function printKOT(items, tableName) {
  if (!items.length) return;
  if (kotPrinterChar) {
    const ok = await sendToKotPrinter(buildKOTBytes(items, tableName));
    if (ok) { toast("KOT sent to kitchen printer"); return; }
  }
  openKotFallbackWindow(items, tableName);
}

$("connectPrinterBtn").onclick = connectKotPrinter;
$("disconnectPrinterBtn").onclick = disconnectKotPrinter;
$("testPrintBtn").onclick = () => printKOT(
  [{ qty: 1, name: "Test Item", variant: null, addons: [], notes: "This is a test ticket" }],
  "Test"
);

// ===================== BILL GENERATION =====================
$("generateBillBtn").onclick = async () => {
  if (!cart.length) { toast("Add items first"); return; }
  const unprintedAtBill = cart.filter(c => !c.printed);
  if (unprintedAtBill.length) await printKOT(unprintedAtBill, `${activeTable.name} ${seatLabelsText(activeSeatLabels)}`);
  const custName = $("orderCustName").value.trim();
  const custPhone = $("orderCustPhone").value.trim();
  const subtotal = cart.reduce((s, c) => s + c.lineTotal, 0);
  const cgstPct = restoData.cgstPct ?? 2.5, sgstPct = restoData.sgstPct ?? 2.5;
  const discount = Math.max(0, parseFloat($("cartDiscount").value) || 0);
  const taxable = Math.max(subtotal - discount, 0);
  const cgst = taxable * cgstPct / 100;
  const sgst = taxable * sgstPct / 100;

  const total = Math.max(taxable + cgst + sgst, 0);

  // sequential bill number via transaction
  const counterRef = doc(db, "restaurants", restoId, "meta", "counters");
  let billNo;
  await runTransaction(db, async (tx) => {
    const c = await tx.get(counterRef);
    const next = (c.exists() ? c.data().billCounter || 0 : 0) + 1;
    tx.set(counterRef, { billCounter: next }, { merge: true });
    billNo = next;
  });

  const seatSuffix = activeSeatLabels.length ? ` (${seatLabelsText(activeSeatLabels)})` : "";
  const billData = {
    billNo, tableName: `${activeTable.name}${seatSuffix}`, seatLabels: activeSeatLabels, items: cart, orderType, paymentMode,
    subtotal, discount, cgst, sgst, cgstPct, sgstPct,
    total,
    customerName: custName, customerPhone: custPhone,
    restoName: restoData.name, restoAddress: restoData.address,
    restoGstin: restoData.gstin, restoPhone: restoData.phone,
    footer: restoData.footer, createdAt: serverTimestamp()
  };
  const billRef = await addDoc(collection(db, "restaurants", restoId, "bills"), billData);

  // close this seat group's order — other seat groups on the same table (if
  // any) are untouched and keep running independently
  if (currentOrder?.id) {
    await updateDoc(doc(db, "restaurants", restoId, "orders", currentOrder.id), { status: "billed" });
    syncCustomerOrderStatus(currentOrder.id, { kitchenStatus: "ready", kdsCleared: true, billed: true });
  }

  openBillModal({ id: billRef.id, ...billData, createdAt: { toDate: () => new Date() } });
  cart = [];
  orderType = "dinein";
  showView("tables");
};

function buildThermalHTML(b) {
  const dt = (b.createdAt?.toDate ? b.createdAt.toDate() : new Date()).toLocaleString("en-IN");
  const itemsHtml = b.items.map(it => `
    <div class="tb-row"><span class="tb-item-name">${it.qty}x ${escapeHtml(it.name)}${it.variant ? " (" + escapeHtml(it.variant) + ")" : ""}</span><span>${money(it.lineTotal)}</span></div>
    ${it.addons?.length ? `<div class="tb-addons">+ ${escapeHtml(addonNames(it.addons))}</div>` : ""}
  `).join("");
  return `
    <div class="tb-center tb-title">${escapeHtml(b.restoName) || "Restaurant"}</div>
    ${b.restoAddress ? `<div class="tb-center">${escapeHtml(b.restoAddress)}</div>` : ""}
    ${b.restoPhone ? `<div class="tb-center">Ph: ${b.restoPhone}</div>` : ""}
    ${b.restoGstin ? `<div class="tb-center">GSTIN: ${b.restoGstin}</div>` : ""}
    <hr>
    <div class="tb-row"><span>Bill No</span><span class="tb-bold">#${b.billNo}</span></div>
    <div class="tb-row"><span>Order type</span><span>${OT_LABEL[b.orderType] || "Dine-in"}</span></div>
    ${b.orderType !== "delivery" && b.orderType !== "takeaway" ? `<div class="tb-row"><span>Table</span><span>${b.tableName || "—"}</span></div>` : ""}
    <div class="tb-row"><span>Date</span><span>${dt}</span></div>
    ${b.customerName ? `<div class="tb-row"><span>Customer</span><span>${escapeHtml(b.customerName)}</span></div>` : ""}
    ${b.customerPhone ? `<div class="tb-row"><span>Phone</span><span>${escapeHtml(b.customerPhone)}</span></div>` : ""}
    <hr>
    ${itemsHtml}
    <hr>
    <div class="tb-row"><span>Subtotal</span><span>${money(b.subtotal)}</span></div>
    ${b.discount ? `<div class="tb-row"><span>Discount</span><span>-${money(b.discount)}</span></div>` : ""}
    <div class="tb-row"><span>CGST (${b.cgstPct}%)</span><span>${money(b.cgst)}</span></div>
    <div class="tb-row"><span>SGST (${b.sgstPct}%)</span><span>${money(b.sgst)}</span></div>
    <hr>
    <div class="tb-row tb-bold tb-total"><span>TOTAL</span><span>${money(b.total)}</span></div>
    <hr>
    <div class="tb-center">${b.footer || "Thank you, visit again!"}</div>
    <div class="tb-center tb-note">Billed via Sip &amp; Scoop Cafe POS</div>
  `;
}

let lastBillForWA = null;
function openBillModal(b) {
  lastBillForWA = b;
  $("thermalBill").innerHTML = buildThermalHTML(b);
  $("billModal").classList.remove("hidden");
}
$("billModalClose").onclick = () => $("billModal").classList.add("hidden");
$("printBillBtn").onclick = () => openPrintPreview();

// ===================== PRINT PREVIEW MODAL =====================
// The single place a bill actually gets printed from — lets the user
// confirm/tweak paper, copies and scale for this one print without
// touching their saved default in Settings.
function refreshPrintPreview() {
  const preset = $("ppvPreset").value;
  const scale = parseInt($("ppvScale").value) || 100;
  const saved = getPrintSettings();
  const widthMm = preset === "custom" ? saved.widthMm : PRINT_PRESETS[preset].width;
  const heightMm = preset === "custom" ? saved.heightMm : PRINT_PRESETS[preset].height;
  const marginMm = saved.marginMm;
  const pxPerMm = 96 / 25.4;
  const paperEl = $("ppvPreviewPaper");
  const content = $("ppvPreviewContent");
  paperEl.style.width = `${widthMm * pxPerMm}px`;
  paperEl.style.minHeight = heightMm ? `${heightMm * pxPerMm}px` : "";
  paperEl.style.padding = `${marginMm * pxPerMm}px`;
  content.style.width = "100%";
  content.style.setProperty("--ppv-scale", scale / 100);
  if (lastBillForWA) $("ppvPreviewContent").innerHTML = buildThermalHTML(lastBillForWA);
}

function openPrintPreview() {
  if (!lastBillForWA) return;
  const s = getPrintSettings();
  $("ppvPreset").value = s.preset;
  $("ppvCopies").value = s.copies;
  $("ppvScale").value = s.scale;
  refreshPrintPreview();
  $("printPreviewModal").classList.remove("hidden");
}
$("ppvPreset").onchange = refreshPrintPreview;
$("ppvScale").oninput = refreshPrintPreview;
$("printPreviewClose").onclick = () => $("printPreviewModal").classList.add("hidden");
$("printPreviewCancel").onclick = () => $("printPreviewModal").classList.add("hidden");

$("ppvPrintBtn").onclick = () => {
  if (!lastBillForWA) return;
  const preset = $("ppvPreset").value;
  const saved = getPrintSettings();
  const settings = {
    preset,
    widthMm: preset === "custom" ? saved.widthMm : PRINT_PRESETS[preset].width,
    heightMm: preset === "custom" ? saved.heightMm : PRINT_PRESETS[preset].height,
    marginMm: saved.marginMm,
    scale: parseInt($("ppvScale").value) || 100,
    copies: parseInt($("ppvCopies").value) || 1
  };
  const inner = buildThermalHTML(lastBillForWA);
  openCustomPrintWindow(inner, settings);
  $("printPreviewModal").classList.add("hidden");
};

// ===================== WHATSAPP BILL MESSAGE =====================
function cleanWhatsAppText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F\uFFFD]/g, " ")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shareBillOnWhatsApp(b) {
  const phone = normalizeWhatsAppBillPhone(b.customerPhone);
  if (!phone) {
    toast("Add a valid customer phone number to this bill before sharing on WhatsApp");
    return;
  }

  const happy = String.fromCodePoint(0x1F60A);
  const restaurant = cleanWhatsAppText(b.restoName || "our cafe");
  const lines = [
    `Thank you for visiting ${restaurant} ${happy}`,
    "",
    `Bill number: ${cleanWhatsAppText(b.billNo)}`
  ];
  if (b.createdAt) {
    const created = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
    if (!Number.isNaN(created.getTime())) lines.push(`Date: ${created.toLocaleString("en-IN")}`);
  }
  if (b.customerName) lines.push(`Customer: ${cleanWhatsAppText(b.customerName)}`);
  if (b.orderType) lines.push(`Order type: ${cleanWhatsAppText(OT_LABEL[b.orderType] || b.orderType)}`);
  if (b.tableName && b.orderType !== "takeaway" && b.orderType !== "delivery") {
    lines.push(`Table: ${cleanWhatsAppText(b.tableName)}`);
  }

  lines.push("", "Items:");
  (b.items || []).forEach(item => {
    const name = cleanWhatsAppText(item.name);
    const variant = item.variant ? ` (${cleanWhatsAppText(item.variant)})` : "";
    const addons = (item.addons || []).map(addon => cleanWhatsAppText(addon.name)).filter(Boolean);
    const addonText = addons.length ? ` with ${addons.join(", ")}` : "";
    lines.push(`${item.qty} x ${name}${variant}${addonText}: ${money(item.lineTotal)}`);
  });
  lines.push(`Subtotal: ${money(b.subtotal)}`);
  if (b.discount > 0) lines.push(`Discount: ${money(b.discount)}`);
  lines.push(`CGST (${b.cgstPct}%): ${money(b.cgst)}`);
  lines.push(`SGST (${b.sgstPct}%): ${money(b.sgst)}`);
  lines.push(`Total: ${money(b.total)}`);
  const paymentLabel = { cash: "Cash", card: "Card", upi: "UPI" }[b.paymentMode] || cleanWhatsAppText(b.paymentMode);
  if (paymentLabel) lines.push(`Payment: ${paymentLabel}`);
  lines.push("", "Thank you. We hope to see you again!");

  const message = lines.join("\n");
  const fullUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
  const shortMsg = `Thank you for visiting ${restaurant} ${happy}\nYour bill no. ${cleanWhatsAppText(b.billNo)} (${money(b.total)}) is attached.`;
  const chatUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(shortMsg)}`;

  // 1) Build the bill as an image and put it on the clipboard (no file saved).
  //    Done first, inside the click, so the browser allows the clipboard write.
  const imagePromise = buildBillImage(b);
  let clipPromise;
  try {
    clipPromise = navigator.clipboard.write([new ClipboardItem({ "image/png": imagePromise })]);
  } catch (err) {
    clipPromise = Promise.reject(err);
  }

  // 2) Open the customer's chat straight away (must happen inside the click too).
  const waWindow = window.open(chatUrl, "_blank");
  if (!waWindow) {
    toast("Allow pop-ups to open WhatsApp with the bill");
    return;
  }

  clipPromise
    .then(() => toast("Bill image copied ✓  In WhatsApp: click the message box, press Ctrl+V, then Enter.", 9000))
    .catch(async (err) => {
      console.error("Bill image copy failed", err);
      // Fallback: same as before — send the bill as a text message.
      try { waWindow.location = fullUrl; } catch (e) { /* ignore */ }
      toast("Couldn't copy the bill image, so the bill is sent as text. Press Enter in WhatsApp.", 6000);
    });
}

// Draws the bill as a clean receipt-style PNG (returns a Promise<Blob>).
async function buildBillImage(b) {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignore */ } }
  const W = 380, P = 22, S = 2;
  const FONT = 'Inter, "Segoe UI", "Nirmala UI", Roboto, Arial, sans-serif';
  const INK = "#161A23", MUTED = "#6B7280", BRAND = "#1B5E4A", LINE = "#C9C2B0";
  const created = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date();
  const pay = { cash: "Cash", card: "Card", upi: "UPI" }[b.paymentMode] || b.paymentMode || "";

  function draw(ctx) {
    let y = P + 6;
    const setFont = (size, weight) => { ctx.font = `${weight || 400} ${size}px ${FONT}`; };
    const wrap = (txt, maxW) => {
      const out = []; let cur = "";
      String(txt ?? "").split(/\s+/).filter(Boolean).forEach(word => {
        const test = cur ? cur + " " + word : word;
        if (ctx.measureText(test).width <= maxW || !cur) cur = test; else { out.push(cur); cur = word; }
      });
      if (cur) out.push(cur);
      return out.length ? out : [""];
    };
    const center = (txt, size, weight, color) => {
      setFont(size, weight); ctx.fillStyle = color; ctx.textAlign = "center";
      wrap(txt, W - 2 * P).forEach(l => { ctx.fillText(l, W / 2, y + size); y += size * 1.35; });
      ctx.textAlign = "left";
    };
    const row = (left, right, o = {}) => {
      const size = o.size || 13.5;
      setFont(size, o.weight); ctx.fillStyle = o.color || INK;
      const rw = right ? ctx.measureText(right).width + 14 : 0;
      wrap(left, W - 2 * P - rw).forEach((l, i) => {
        ctx.textAlign = "left"; ctx.fillText(l, P + (o.indent || 0), y + size);
        if (i === 0 && right) { ctx.textAlign = "right"; ctx.fillText(right, W - P, y + size); ctx.textAlign = "left"; }
        y += size * 1.5;
      });
    };
    const rule = () => {
      y += 5; ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke(); ctx.setLineDash([]); y += 9;
    };

    center(b.restoName || "Restaurant", 21, 800, BRAND); y += 2;
    if (b.restoAddress) center(b.restoAddress, 12, 400, MUTED);
    if (b.restoPhone) center("Ph: " + b.restoPhone, 12, 400, MUTED);
    if (b.restoGstin) center("GSTIN: " + b.restoGstin, 12, 400, MUTED);
    y += 4; rule();

    row("Bill No: " + b.billNo, "", { weight: 700 });
    row("Date: " + created.toLocaleString("en-IN"), "", { size: 12.5, color: MUTED });
    if (b.customerName) row("Customer: " + b.customerName, "", { size: 12.5, color: MUTED });
    if (b.orderType) row("Order: " + (OT_LABEL[b.orderType] || b.orderType), "", { size: 12.5, color: MUTED });
    if (b.tableName && b.orderType !== "takeaway" && b.orderType !== "delivery") row("Table: " + b.tableName, "", { size: 12.5, color: MUTED });
    rule();

    row("Item", "Amount", { weight: 700, size: 12.5, color: MUTED });
    (b.items || []).forEach(it => {
      const variant = it.variant ? ` (${it.variant})` : "";
      row(`${it.qty} × ${it.name}${variant}`, money(it.lineTotal), { weight: 600 });
      const addons = (it.addons || []).map(x => (typeof x === "string" ? x : x.name)).filter(Boolean);
      if (addons.length) row("+ " + addons.join(", "), "", { size: 11.5, color: MUTED, indent: 12 });
    });
    rule();

    row("Subtotal", money(b.subtotal));
    if (b.discount > 0) row("Discount", "-" + money(b.discount));
    row(`CGST (${b.cgstPct}%)`, money(b.cgst));
    row(`SGST (${b.sgstPct}%)`, money(b.sgst));
    y += 4;
    // total band
    ctx.fillStyle = "#E2EFE8"; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(P - 8, y - 2, W - 2 * P + 16, 38, 10); else ctx.rect(P - 8, y - 2, W - 2 * P + 16, 38);
    ctx.fill();
    y += 8; row("TOTAL", money(b.total), { size: 18, weight: 800, color: BRAND }); y += 6;
    if (pay) row("Paid via " + pay, "", { size: 12.5, color: MUTED });
    y += 2; rule();
    center(b.footer || "Thank you, visit again!", 13, 600, INK);
    return y + P;
  }

  const probe = document.createElement("canvas"); probe.width = W; probe.height = 3000;
  const H = Math.ceil(draw(probe.getContext("2d")));
  const canvas = document.createElement("canvas"); canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext("2d"); ctx.scale(S, S);
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
  draw(ctx);
  return new Promise((resolve, reject) => canvas.toBlob(bl => bl ? resolve(bl) : reject(new Error("Image export failed")), "image/png"));
}

function normalizeWhatsAppBillPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  // Indian mobile numbers must start with 6-9, including local forms.
  if (digits.length === 10) {
    if (!/^[6-9]\d{9}$/.test(digits)) return "";
    digits = "91" + digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    const localNumber = digits.slice(1);
    if (!/^[6-9]\d{9}$/.test(localNumber)) return "";
    digits = "91" + localNumber;
  } else if (digits.length === 12 && digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) {
    return "";
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

$("waBillBtn").onclick = () => { if (lastBillForWA) shareBillOnWhatsApp(lastBillForWA); };

// ===================== BILL HISTORY =====================
function findBill(id) { return billsCache.find(b => b.id === id) || olderBillsCache.find(b => b.id === id) || olderSearchResults.find(b => b.id === id); }
function allBills() { return olderBillsCache.length ? billsCache.concat(olderBillsCache) : billsCache; }

function wireBillRowButtons(container) {
  container.querySelectorAll("[data-view]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openBillModal(findBill(btn.dataset.view)); };
  });
  container.querySelectorAll("[data-share]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); const b = findBill(btn.dataset.share); if (b) shareBillOnWhatsApp(b); };
  });
  container.querySelectorAll("[data-del-bill]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const b = findBill(btn.dataset.delBill);
      const ok = await showConfirm(
        `Bill #${b?.billNo ?? ""} will be permanently removed from your records. This can't be undone.`,
        { title: "Delete this bill?", danger: true, okLabel: "Delete" }
      );
      if (ok) { await deleteDoc(doc(db, "restaurants", restoId, "bills", btn.dataset.delBill)); afterBillDeleted(btn.dataset.delBill); toast("Bill deleted"); }
    };
  });
  container.querySelectorAll(".list-row").forEach(r => {
    r.onclick = () => openBillModal(findBill(r.dataset.id));
  });
}

// Only the last LIVE_BILL_DAYS days of bills are streamed live (this keeps Firestore reads low
// on the free plan). Everything older is still safely stored — owners can search it below
// ("Search older bills") and Sales Summary can load it on demand ("Load older data").
const billRowHtml = (b) => `
    <div class="list-row" data-id="${b.id}">
      <div><div class="lr-main">#${b.billNo} · ${escapeHtml(b.tableName) || "Takeaway"} ${orderTypeBadge(b.orderType)}</div>
      <div class="lr-sub">${escapeHtml(b.customerName) || "Walk-in"} ${b.customerPhone ? "· " + escapeHtml(b.customerPhone) : ""} · ${b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString("en-IN") : ""}</div></div>
      <div class="lr-actions">
        <div class="lr-amt">${money(b.total)}</div>
        <button class="lr-btn" data-view="${b.id}" title="View bill">👁</button>
        <button class="lr-btn" data-share="${b.id}" title="Send bill on WhatsApp">📲</button>
        <button class="lr-btn lr-danger" data-del-bill="${b.id}" title="Delete bill">🗑</button>
      </div>
    </div>`;

const toDateInputValue = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtLongDate = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function renderBillHistory() {
  const el = $("billHistoryList");
  if ($("billWindowNote") && billsWindowStart) {
    $("billWindowNote").textContent = `Showing the last ${LIVE_BILL_DAYS} days (from ${fmtLongDate(billsWindowStart)}). Older bills are safe — use "Search older bills" above to find them.`;
  }
  // pre-fill the older-bills date range: the 30 days just before the live window
  if ($("olderTo") && billsWindowStart && !$("olderTo").value) {
    const to = new Date(billsWindowStart); to.setDate(to.getDate() - 1);
    const from = new Date(to); from.setDate(from.getDate() - 29);
    $("olderTo").value = toDateInputValue(to);
    $("olderFrom").value = toDateInputValue(from);
  }
  if (!billsCache.length) { el.innerHTML = `<div class="empty-note">No bills in the last ${LIVE_BILL_DAYS} days. Use “Search older bills” above to look further back.</div>`; return; }
  el.innerHTML = billsCache.map(billRowHtml).join("");
  wireBillRowButtons(el);
}

// ---- Search older bills (on demand, max OLDER_PAGE bills read per click) ----
const OLDER_PAGE = 300;
const billsColRef = () => collection(db, "restaurants", restoId, "bills");

function renderOlderResults() {
  const out = $("olderBillsList"), msg = $("olderBillsMsg"), more = $("olderMoreBtn");
  if (!out) return;
  out.innerHTML = olderSearchResults.map(billRowHtml).join("");
  wireBillRowButtons(out);
  if (!olderState) { msg.textContent = ""; more.classList.add("hidden"); return; }
  const total = olderSearchResults.reduce((s, b) => s + (b.total || 0), 0);
  msg.innerHTML = olderSearchResults.length
    ? `Found <b>${olderSearchResults.length}</b> bill${olderSearchResults.length === 1 ? "" : "s"} · total <b>${money(total)}</b>${olderState.mode === "range" && !olderState.done ? " · there may be more in this range" : ""}`
    : `No bills found for that search.`;
  more.classList.toggle("hidden", !(olderState.mode === "range" && !olderState.done));
}

async function searchOlderBills(loadMore) {
  const btn = $("olderSearchBtn"), moreBtn = $("olderMoreBtn"), msg = $("olderBillsMsg");
  let st;
  if (loadMore && olderState) st = olderState;
  else {
    const text = ($("olderQuery").value || "").trim();
    const digits = text.replace(/\D/g, "");
    const looksLikePhone = digits.length >= 10 && digits.length === text.replace(/[\s+\-()]/g, "").length;
    if (/^\d{1,8}$/.test(text)) st = { mode: "billNo", value: Number(text), done: true };
    else if (looksLikePhone) st = { mode: "phone", value: [...new Set([text, digits, digits.slice(-10)])], done: true };
    else {
      const f = $("olderFrom").value, t = $("olderTo").value;
      if (!f || !t) { msg.textContent = "Pick a From and To date — or type a bill number or phone number."; return; }
      const from = new Date(f + "T00:00:00"), to = new Date(t + "T23:59:59.999");
      if (from > to) { msg.textContent = "The From date must be earlier than the To date."; return; }
      st = { mode: "range", from, to, name: text.toLowerCase(), cursor: null, done: false };
    }
    olderState = st; olderSearchResults = [];
  }
  btn.disabled = true; moreBtn.disabled = true; const oldLabel = btn.textContent; btn.textContent = "Searching…";
  try {
    let snap;
    if (st.mode === "billNo") snap = await getDocs(query(billsColRef(), where("billNo", "==", st.value)));
    else if (st.mode === "phone") snap = await getDocs(query(billsColRef(), where("customerPhone", "in", st.value), limit(OLDER_PAGE)));
    else {
      const parts = [where("createdAt", ">=", Timestamp.fromDate(st.from)), where("createdAt", "<=", Timestamp.fromDate(st.to)), orderBy("createdAt", "desc"), limit(OLDER_PAGE)];
      if (st.cursor) parts.push(startAfter(st.cursor));
      snap = await getDocs(query(billsColRef(), ...parts));
      st.cursor = snap.docs[snap.docs.length - 1] || st.cursor;
      st.done = snap.size < OLDER_PAGE;
    }
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (st.mode === "range" && st.name) items = items.filter(b => `${b.customerName || ""} ${b.tableName || ""}`.toLowerCase().includes(st.name));
    if (st.mode === "phone") items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const seen = new Set(olderSearchResults.map(b => b.id));
    olderSearchResults = olderSearchResults.concat(items.filter(b => !seen.has(b.id)));
    renderOlderResults();
  } catch (e) {
    console.error(e);
    msg.textContent = "Couldn't search right now: " + (e.message || e);
  } finally {
    btn.disabled = false; moreBtn.disabled = false; btn.textContent = oldLabel;
  }
}
if ($("olderSearchBtn")) {
  $("olderSearchBtn").onclick = () => searchOlderBills(false);
  $("olderMoreBtn").onclick = () => searchOlderBills(true);
  $("olderQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") searchOlderBills(false); });
}

function afterBillDeleted(id) {
  olderBillsCache = olderBillsCache.filter(b => b.id !== id);
  olderSearchResults = olderSearchResults.filter(b => b.id !== id);
  renderOlderResults();
  if ($("view-sales") && $("view-sales").classList.contains("active")) renderSalesSummary();
}

// ---- Sales Summary: load older bills for long-range reports (asks before reading) ----
let histSel = "365";
function renderHistBar() {
  const el = $("histBar"); if (!el || !billsWindowStart) return;
  const full = olderLoadedFrom && olderLoadedFrom.getFullYear() <= 2000;
  const n = olderBillsCache.length.toLocaleString("en-IN");
  let info;
  if (!olderLoadedFrom) info = `Live data covers the last ${LIVE_BILL_DAYS} days (from ${fmtLongDate(billsWindowStart)}). “This year” and the longer trend charts need older bills.`;
  else if (full) info = `Full history loaded — ${n} older bills included.`;
  else info = `Older bills loaded back to ${fmtLongDate(olderLoadedFrom)} (${n} older bills included).`;
  const opt = (v, t) => `<option value="${v}" ${histSel === v ? "selected" : ""}>${t}</option>`;
  el.innerHTML = `<span class="hb-info">📅 ${info}</span>` + (full ? "" :
    `<span class="hb-act"><select id="histRange" aria-label="How far back to load">${opt("90", "Last 3 months")}${opt("365", "Last 12 months")}${opt("all", "Everything")}</select><button type="button" class="btn-ghost" id="histLoadBtn">Load older data</button></span>`);
  if ($("histRange")) $("histRange").onchange = (e) => { histSel = e.target.value; };
  if ($("histLoadBtn")) $("histLoadBtn").onclick = loadOlderHistory;
}

async function loadOlderHistory() {
  const btn = $("histLoadBtn"); if (!btn || !billsWindowStart) return;
  histSel = $("histRange").value;
  const lower = histSel === "all" ? new Date(2000, 0, 1) : (() => { const d = new Date(billsWindowStart); d.setDate(d.getDate() - Number(histSel)); return d; })();
  const upper = olderLoadedFrom || billsWindowStart;
  if (lower >= upper) { toast("That period is already loaded"); return; }
  const range = [where("createdAt", ">=", Timestamp.fromDate(lower)), where("createdAt", "<", Timestamp.fromDate(upper))];
  btn.disabled = true; btn.textContent = "Counting…";
  try {
    const count = (await getCountFromServer(query(billsColRef(), ...range))).data().count;
    if (!count) { olderLoadedFrom = lower; toast("No older bills in that period"); renderSalesSummary(); return; }
    const big = count > 40000 ? "\n\nThat is close to the whole free daily limit (50,000) — consider a shorter period." : "";
    const ok = await showConfirm(
      `${count.toLocaleString("en-IN")} older bills found. Loading them uses about ${count.toLocaleString("en-IN")} Firestore reads (the free plan allows 50,000 per day).${big}`,
      { title: "Load older data?", okLabel: "Load" }
    );
    if (!ok) return;
    let cursor = null, loaded = 0;
    for (;;) {
      const parts = [...range, orderBy("createdAt", "desc"), limit(1000)];
      if (cursor) parts.push(startAfter(cursor));
      const snap = await getDocs(query(billsColRef(), ...parts));
      const have = new Set(olderBillsCache.map(b => b.id));
      snap.docs.forEach(d => { if (!have.has(d.id)) olderBillsCache.push({ id: d.id, ...d.data() }); });
      loaded += snap.size;
      btn.textContent = `Loading… ${loaded.toLocaleString("en-IN")}`;
      if (snap.size < 1000) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    olderLoadedFrom = lower;
    toast(`Loaded ${loaded.toLocaleString("en-IN")} older bills`);
    renderSalesSummary();
  } catch (e) {
    console.error(e);
    toast("Couldn't load older data: " + (e.message || e));
  } finally {
    const b2 = $("histLoadBtn"); if (b2) { b2.disabled = false; b2.textContent = "Load older data"; }
  }
}

// ---- QR menu snapshot: customers read ONE small doc instead of every menu item ----
function quickHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }
async function writePublicMenu(items, sig) {
  try {
    await setDoc(doc(db, "restaurants", restoId, "public", "menu"), { items, sig, updatedAt: serverTimestamp() });
    publicMenuSig = sig;
  } catch (e) { console.warn("Public menu snapshot not saved (QR page will read the menu directly):", e); }
}
function syncPublicMenu(snap) {
  const items = menuCache.map(m => ({ ...m })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const sig = quickHash(JSON.stringify(items));
  if (!publicMenuChecked) {
    if (snap.metadata.fromCache) return;
    publicMenuChecked = true;
    getDoc(doc(db, "restaurants", restoId, "public", "menu"))
      .then(cur => { if (!cur.exists() || cur.data().sig !== sig) return writePublicMenu(items, sig); publicMenuSig = sig; })
      .catch(e => console.warn("Public menu check skipped:", e));
    return;
  }
  // only the device that edited the menu writes the snapshot
  if (!snap.metadata.hasPendingWrites || sig === publicMenuSig) return;
  clearTimeout(publicMenuTimer);
  publicMenuTimer = setTimeout(() => writePublicMenu(items, sig), 1500);
}


// ===================== SETTINGS =====================
// Live summary chips in the settings hero — a quick, at-a-glance health
// check of the setup, computed from whatever's currently on screen/in state.
function updateSettingsStatusStrip() {
  const taxEl = $("sstTaxValue");
  if (taxEl) {
    const cgst = parseFloat($("setCgst")?.value) || 0;
    const sgst = parseFloat($("setSgst")?.value) || 0;
    taxEl.textContent = (cgst + sgst) > 0 ? `${(cgst + sgst).toFixed(1)}% (${cgst}+${sgst})` : "Not set";
  }
  const printerEl = $("sstPrinterValue");
  if (printerEl) {
    const connected = $("kotPrinterStatus")?.classList.contains("connected");
    printerEl.textContent = connected ? "Connected" : "Not connected";
  }
}

function populateSettings() {
  $("setName").value = restoData.name || "";
  $("setAddress").value = restoData.address || "";
  $("setPhone").value = restoData.phone || "";
  $("setGstin").value = restoData.gstin || "";
  $("setCgst").value = restoData.cgstPct ?? 2.5;
  $("setSgst").value = restoData.sgstPct ?? 2.5;
  $("setFooter").value = restoData.footer || "Thank you, visit again!";
  populatePrintSettingsUI();
  populateNotificationSettingsUI();
  updateSettingsStatusStrip();
  if ($("darkKitchenToggle")) $("darkKitchenToggle").checked = !!restoData.darkKitchenMode;
}
["setCgst", "setSgst"].forEach(id => $(id).addEventListener("input", updateSettingsStatusStrip));

// ===================== CLOUD KITCHEN / DARK KITCHEN MODE =====================
// Purely a presentation toggle: hides the dine-in-specific Tables & Orders
// nav item (and its floor map) for kitchens that only do delivery/takeaway,
// and adds a packaging checklist gate on the KDS for non-dine-in orders.
// No billing, order, or Firestore-schema logic is touched by this.
function applyDarkKitchenModeUI() {
  const on = !!restoData.darkKitchenMode;
  document.body.classList.toggle("dark-kitchen-mode", on);
  const tablesNav = document.querySelector('.nav-item[data-view="tables"]');
  if (tablesNav) tablesNav.style.display = on ? "none" : "";
}
if ($("darkKitchenToggle")) {
  $("darkKitchenToggle").onchange = async () => {
    const darkKitchenMode = $("darkKitchenToggle").checked;
    await setDoc(doc(db, "restaurants", restoId), { darkKitchenMode }, { merge: true });
    restoData = { ...restoData, darkKitchenMode };
    applyDarkKitchenModeUI();
    toast(darkKitchenMode ? "Cloud kitchen mode on" : "Cloud kitchen mode off");
  };
}

$("saveSettingsBtn").onclick = async () => {
  const data = {
    name: $("setName").value.trim(),
    address: $("setAddress").value.trim(),
    phone: $("setPhone").value.trim(),
    gstin: $("setGstin").value.trim(),
    cgstPct: Math.min(100, Math.max(0, parseFloat($("setCgst").value) || 0)),
    sgstPct: Math.min(100, Math.max(0, parseFloat($("setSgst").value) || 0)),
    footer: $("setFooter").value.trim()
  };
  await setDoc(doc(db, "restaurants", restoId), data, { merge: true });
  // Mirror only the name into the public-readable doc the QR ordering page
  // uses — restaurants/{restoId} itself now requires owner auth (it also
  // holds staffPinHash), so the public page can no longer read it directly.
  await setDoc(doc(db, "restaurants", restoId, "public", "info"), { name: data.name }, { merge: true });
  restoData = { ...restoData, ...data };
  $("sbRestoName").textContent = data.name;
  updateSettingsStatusStrip();
  toast("Settings saved");
};